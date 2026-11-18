import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { createInvite, pushCaseToBwf, submitResponse } from "@/services/survey";
import { getDashboardMetrics } from "@/services/metrics";

async function invite(incidentId: string, supportGroup = "Service Desk") {
  return createInvite({ incidentId, supportGroup, requesterEmail: "u@example.test" });
}

beforeEach(async () => {
  await db.recoveryCase.deleteMany();
  await db.surveyResponse.deleteMany();
  await db.surveyInvite.deleteMany();
});

describe("submitResponse", () => {
  it("SATISFIED creates a response and no case", async () => {
    const i = await invite("INC1");
    await submitResponse({ token: i.token, satisfaction: "SATISFIED" });
    expect(await db.surveyResponse.count()).toBe(1);
    expect(await db.recoveryCase.count()).toBe(0);
    expect((await db.surveyInvite.findUnique({ where: { token: i.token } }))?.status).toBe("RESPONDED");
  });

  it("UNSATISFIED creates a case and pushes it to BWF", async () => {
    const i = await invite("INC2");
    await submitResponse({ token: i.token, satisfaction: "UNSATISFIED", dissatisfactionReason: "Took too long" });
    const rc = await db.recoveryCase.findFirstOrThrow();
    expect(rc.status).toBe("CREATED");
    expect(rc.bwfCaseNumber).toMatch(/^EXP-/);
    expect(rc.assignedTeam).toBe("Experience Management Team");
  });

  it("ADR-004: BWF outage keeps the response, marks the case FAILED, and retry recovers it", async () => {
    const i = await invite("INC-FAIL-3");
    await expect(submitResponse({ token: i.token, satisfaction: "UNSATISFIED" })).resolves.toBeTruthy();
    expect(await db.surveyResponse.count()).toBe(1);
    const failed = await db.recoveryCase.findFirstOrThrow();
    expect(failed.status).toBe("FAILED");
    expect(failed.lastError).toContain("BWF unavailable");

    // Retry still fails for a FAIL incident; attempts must increase, status stays FAILED.
    const again = await pushCaseToBwf(failed.id);
    expect(again.status).toBe("FAILED");
    expect(again.attempts).toBe(2);

    // Outage over: change the incident id so the mock succeeds, then retry.
    await db.surveyInvite.update({ where: { token: i.token }, data: { incidentId: "INC-OK-3" } });
    const fixed = await pushCaseToBwf(failed.id);
    expect(fixed.status).toBe("CREATED");
    expect(fixed.lastError).toBeNull();
  });

  it("rejects a second submission with 409 and keeps one response", async () => {
    const i = await invite("INC4");
    await submitResponse({ token: i.token, satisfaction: "SATISFIED" });
    await expect(submitResponse({ token: i.token, satisfaction: "UNSATISFIED" })).rejects.toMatchObject({ status: 409 });
    expect(await db.surveyResponse.count()).toBe(1);
  });

  it("rejects expired links with 410 and marks them EXPIRED", async () => {
    const i = await invite("INC5");
    await db.surveyInvite.update({ where: { token: i.token }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(submitResponse({ token: i.token, satisfaction: "SATISFIED" })).rejects.toMatchObject({ status: 410 });
    expect((await db.surveyInvite.findUnique({ where: { token: i.token } }))?.status).toBe("EXPIRED");
  });

  it("rejects unknown tokens with 404 and invalid input with a validation error", async () => {
    await expect(submitResponse({ token: "x".repeat(20), satisfaction: "SATISFIED" })).rejects.toBeInstanceOf(HttpError);
    await expect(submitResponse({ token: "short", satisfaction: "MAYBE" })).rejects.toThrow();
  });
});

describe("getDashboardMetrics scoping", () => {
  it("a SUPPORT_GROUP user sees only their own group, admin sees all", async () => {
    const a = await invite("INC6", "Service Desk");
    const b = await invite("INC7", "Network");
    await submitResponse({ token: a.token, satisfaction: "SATISFIED" });
    await submitResponse({ token: b.token, satisfaction: "UNSATISFIED" });

    const desk = await getDashboardMetrics({ role: "SUPPORT_GROUP", supportGroup: "Service Desk" });
    expect(desk).toMatchObject({ invites: 1, responses: 1, satisfied: 1, unsatisfied: 0 });
    expect(desk.cases.created + desk.cases.failed + desk.cases.pending).toBe(0);

    const none = await getDashboardMetrics({ role: "SUPPORT_GROUP", supportGroup: null });
    expect(none.invites).toBe(0);

    const all = await getDashboardMetrics({ role: "ADMIN", supportGroup: null });
    expect(all).toMatchObject({ invites: 2, responses: 2, unsatisfied: 1 });
  });
});
