import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import type { HelixConnector, HelixIncident } from "@/connectors/types";
import { mockHelix } from "@/connectors/mock";
import { NOT_RESOLVED, openSurveyForIncident, submitResponse } from "@/services/survey";

const good = (over: Partial<HelixIncident> = {}): HelixIncident => ({
  incidentId: "INC000123",
  supportGroup: "Network",
  requesterEmail: "req@example.test",
  status: "Resolved",
  accessKey: "IDGAA5V0GWDQ-key-1",
  ...over,
});
const stub = (inc: HelixIncident | null) => ({ getIncident: vi.fn(async () => inc) }) satisfies HelixConnector;
const link = { incident: "INC000123", key: "IDGAA5V0GWDQ-key-1" };

beforeEach(async () => {
  await db.recoveryCase.deleteMany();
  await db.surveyResponse.deleteMany();
  await db.incidentLink.deleteMany();
  await db.surveyInvite.deleteMany();
});

describe("openSurveyForIncident", () => {
  it("creates a survey from Helix data, not from the link", async () => {
    const { token } = await openSurveyForIncident(link, stub(good()));
    const invite = await db.surveyInvite.findUniqueOrThrow({ where: { token } });
    expect(invite).toMatchObject({ incidentId: "INC000123", supportGroup: "Network", requesterEmail: "req@example.test" });
  });

  it("a second click gets the same survey, and Helix is asked every time", async () => {
    const c = stub(good());
    const a = await openSurveyForIncident(link, c);
    const b = await openSurveyForIncident(link, c);
    expect(b.token).toBe(a.token);
    expect(await db.surveyInvite.count()).toBe(1);
    expect(c.getIncident).toHaveBeenCalledTimes(2);
  });

  it("two clicks at the same moment still make only one survey", async () => {
    const c = stub(good());
    const [a, b] = await Promise.all([openSurveyForIncident(link, c), openSurveyForIncident(link, c)]);
    expect(a.token).toBe(b.token);
    expect(await db.surveyInvite.count()).toBe(1);
  });

  it.each([
    ["wrong key", { ...link, key: "IDGAA5V0GWDQ-key-2" }, good()],
    ["incident not found", link, null],
    ["no requester", link, good({ requesterEmail: "" })],
    ["invalid requester", link, good({ requesterEmail: "not-an-email" })],
    ["Helix has no key for the incident", link, good({ accessKey: null })],
  ])("rejects: %s (404, nothing created)", async (_name, input, inc) => {
    await expect(openSurveyForIncident(input, stub(inc))).rejects.toMatchObject({ status: 404 });
    expect(await db.surveyInvite.count()).toBe(0);
  });

  it("accepts a Closed incident and status text in any case", async () => {
    await expect(openSurveyForIncident(link, stub(good({ status: "closed" })))).resolves.toBeTruthy();
  });

  it("rejects malformed links without calling Helix", async () => {
    const c = stub(good());
    for (const bad of [{}, { incident: "INC1\" OR 1=1" , key: "abcdefgh" }, { incident: "INC000123", key: "short" }, { incident: "x".repeat(50), key: "abcdefgh" }]) {
      await expect(openSurveyForIncident(bad, c)).rejects.toMatchObject({ status: 404 });
    }
    expect(c.getIncident).not.toHaveBeenCalled();
  });

  it("returns the same message for every invalid reason, so incidents cannot be probed", async () => {
    const msgs = new Set<string>();
    for (const [input, inc] of [[link, null], [{ ...link, key: "wrongkey-123" }, good()], [{ ...link, key: "wrongkey-123" }, good({ status: "Assigned" })]] as const) {
      msgs.add((await openSurveyForIncident(input, stub(inc)).catch((e) => e.message)) as string);
    }
    expect(msgs.size).toBe(1);
  });

  it("says 'not resolved' (409) only when the key matches, and nothing is created", async () => {
    const err = await openSurveyForIncident(link, stub(good({ status: "In Progress" }))).catch((e) => e);
    expect(err).toMatchObject({ status: 409, message: NOT_RESOLVED });
    expect(err.message).not.toContain("In Progress");
    expect(await db.surveyInvite.count()).toBe(0);
  });

  it("503 when Helix is down, and nothing is created", async () => {
    const down: HelixConnector = { getIncident: async () => { throw new Error("boom: secret details"); } };
    const err = await openSurveyForIncident(link, down).catch((e) => e);
    expect(err).toMatchObject({ status: 503 });
    expect(err.message).not.toContain("secret");
    expect(await db.surveyInvite.count()).toBe(0);
  });

  it("409 after the survey was answered, 410 after it expired", async () => {
    const c = stub(good());
    const { token } = await openSurveyForIncident(link, c);
    await db.surveyInvite.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(openSurveyForIncident(link, c)).rejects.toMatchObject({ status: 410 });
    await db.surveyInvite.update({ where: { token }, data: { expiresAt: new Date(Date.now() + 60_000), status: "PENDING" } });
    await submitResponse({ token, satisfaction: "SATISFIED" });
    await expect(openSurveyForIncident(link, c)).rejects.toMatchObject({ status: 409 });
  });
});

describe("mock Helix paths (for demos)", () => {
  it.each([
    ["INC-OK-1", "ok"], ["INC-OPEN-1", 409], ["INC-MISSING-1", 404], ["INC-NOREQ-1", 404], ["INC-HELIXDOWN-1", 503],
  ])("%s -> %s", async (id, expected) => {
    const run = openSurveyForIncident({ incident: id, key: `key-${id}` }, mockHelix);
    if (expected === "ok") await expect(run).resolves.toHaveProperty("token");
    else await expect(run).rejects.toMatchObject({ status: expected });
  });
});
