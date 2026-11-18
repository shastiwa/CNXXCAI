import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as submitRoute } from "@/app/api/survey/submit/route";
import { db } from "@/lib/db";
import { mockHelix } from "@/connectors/mock";
import { findAttachmentForViewer } from "@/services/responses";
import { setReasons, DEFAULT_REASONS } from "@/services/reasons";
import { getSettings, saveSettings } from "@/services/settings";
import { createInvite, getSurveyContext, openSurveyForIncident, submitResponse } from "@/services/survey";

const UPLOADS = path.resolve(process.cwd(), ".test-uploads");
const files = () => (existsSync(UPLOADS) ? readdirSync(UPLOADS) : []);

// Smallest real-looking files: the first bytes are what the checker looks at.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const PDF = Buffer.from("%PDF-1.4\n%fake test file\n");
const png = (name = "screen.png") => ({ name, bytes: PNG });

async function invite(incidentId: string, supportGroup = "Service Desk") {
  return createInvite({ incidentId, supportGroup, requesterEmail: "u@example.test" });
}
const unsat = (token: string, extra: object = {}) => ({ token, satisfaction: "UNSATISFIED", ...extra });

async function reset() {
  await db.surveyAttachment.deleteMany();
  await db.recoveryCase.deleteMany();
  await db.surveyResponse.deleteMany();
  await db.incidentLink.deleteMany();
  await db.surveyInvite.deleteMany();
  await db.appSetting.deleteMany();
  await db.surveyReason.deleteMany();
  rmSync(UPLOADS, { recursive: true, force: true });
}
beforeEach(reset);
afterAll(reset); // other test files delete responses, so no attachment rows may be left behind

describe("attachments", () => {
  it("saves a valid file with its hash, on disk under a random name", async () => {
    const i = await invite("INC-A1");
    await submitResponse(unsat(i.token), [png("my shot.png")]);
    const a = await db.surveyAttachment.findFirstOrThrow();
    expect(a).toMatchObject({ fileName: "my shot.png", contentType: "image/png", sizeBytes: PNG.length });
    expect(a.sha256).toHaveLength(64);
    expect(a.storageKey).toMatch(/^[a-f0-9]{32}\.png$/);
    expect(files()).toEqual([a.storageKey]);
  });

  it.each([
    ["a program renamed .exe", { name: "setup.exe", bytes: Buffer.from("MZ....") }, /not allowed/],
    ["text pretending to be a png", { name: "x.png", bytes: Buffer.from("hello, not an image") }, /does not match/],
    ["a png renamed .pdf", { name: "x.pdf", bytes: PNG }, /does not match/],
    ["an empty file", { name: "x.png", bytes: Buffer.alloc(0) }, /empty/],
    ["a file over the size limit", { name: "big.png", bytes: Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]) }, /larger than 5 MB/],
    ["a double extension that ends in a blocked type", { name: "photo.png.exe", bytes: PNG }, /not allowed/],
  ])("refuses %s and saves nothing", async (_n, file, msg) => {
    const i = await invite("INC-A2");
    await expect(submitResponse(unsat(i.token), [file])).rejects.toMatchObject({ status: 400, message: expect.stringMatching(msg) });
    expect(await db.surveyResponse.count()).toBe(0);
    expect(files()).toEqual([]);
    expect((await db.surveyInvite.findUniqueOrThrow({ where: { token: i.token } })).status).toBe("PENDING"); // user can fix and retry
  });

  it("refuses too many files, and any file on a Satisfied answer", async () => {
    const i = await invite("INC-A3");
    await expect(submitResponse(unsat(i.token), [png(), png(), png(), png()])).rejects.toMatchObject({ status: 400 });
    await expect(submitResponse({ token: i.token, satisfaction: "SATISFIED" }, [png()])).rejects.toMatchObject({ status: 400 });
    expect(await db.surveyResponse.count()).toBe(0);
  });

  it("never uses the user's file name as a path", async () => {
    const i = await invite("INC-A4");
    await submitResponse(unsat(i.token), [png("..\\..\\evil/../name.png")]);
    const a = await db.surveyAttachment.findFirstOrThrow();
    expect(a.fileName).not.toMatch(/[\\/]/);
    expect(files()).toEqual([a.storageKey]);
  });

  it("a second submit leaves no orphan files and keeps the first response", async () => {
    const i = await invite("INC-A5");
    await submitResponse(unsat(i.token), [png()]);
    await expect(submitResponse(unsat(i.token), [png("again.png")])).rejects.toMatchObject({ status: 409 });
    expect(files()).toHaveLength(1);
    expect(await db.surveyAttachment.count()).toBe(1);
  });

  it("two submits at the same moment save one response and one file", async () => {
    const i = await invite("INC-A6");
    const results = await Promise.allSettled([submitResponse(unsat(i.token), [png("a.png")]), submitResponse(unsat(i.token), [png("b.png")])]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.surveyResponse.count()).toBe(1);
    expect(files()).toHaveLength(1);
  });

  it("limits come from settings: maxFiles 0 turns attachments off; a removed type is refused", async () => {
    const i = await invite("INC-A7");
    await saveSettings({ allowedExtensions: ["pdf"] });
    await expect(submitResponse(unsat(i.token), [png()])).rejects.toMatchObject({ status: 400 });
    await expect(submitResponse(unsat(i.token), [{ name: "a.pdf", bytes: PDF }])).resolves.toBeTruthy();
    const j = await invite("INC-A8");
    await saveSettings({ maxFiles: 0 });
    await expect(submitResponse(unsat(j.token), [{ name: "a.pdf", bytes: PDF }])).rejects.toMatchObject({ status: 400 });
  });
});

describe("submit route (multipart)", () => {
  const post = (form: FormData) => submitRoute(new Request("http://localhost/api/survey/submit", { method: "POST", body: form }));

  it("accepts a form with a file", async () => {
    const i = await invite("INC-R1");
    const f = new FormData();
    f.set("token", i.token); f.set("satisfaction", "UNSATISFIED"); f.set("dissatisfactionReason", "Issue still persists");
    f.set("comments", "still broken"); f.append("files", new File([new Uint8Array(PNG)], "s.png", { type: "image/png" }));
    expect((await post(f)).status).toBe(201);
    const r = await db.surveyResponse.findFirstOrThrow({ include: { attachments: true } });
    expect(r).toMatchObject({ dissatisfactionReason: "Issue still persists", comments: "still broken" });
    expect(r.attachments).toHaveLength(1);
  });

  it("an empty file picker is ignored, and a bad file gives 400 not 500", async () => {
    const i = await invite("INC-R2");
    const ok = new FormData();
    ok.set("token", i.token); ok.set("satisfaction", "SATISFIED"); ok.append("files", new File([], ""));
    expect((await post(ok)).status).toBe(201);

    const j = await invite("INC-R3");
    const bad = new FormData();
    bad.set("token", j.token); bad.set("satisfaction", "UNSATISFIED"); bad.append("files", new File(["MZ"], "a.exe"));
    expect((await post(bad)).status).toBe(400);
  });

  it("refuses an upload that is declared far larger than the limit (413)", async () => {
    const res = await submitRoute(new Request("http://localhost/api/survey/submit", {
      method: "POST", headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(100 * 1024 * 1024) }, body: "x",
    }));
    expect(res.status).toBe(413);
  });
});

describe("reasons", () => {
  it("accepts a listed reason, refuses an unlisted one, and follows admin changes", async () => {
    const i = await invite("INC-S1");
    await expect(submitResponse(unsat(i.token, { dissatisfactionReason: "Because I said so" }))).rejects.toMatchObject({ status: 400 });
    await setReasons(["Too slow", "Other"]);
    await expect(submitResponse(unsat(i.token, { dissatisfactionReason: "Issue still persists" }))).rejects.toMatchObject({ status: 400 }); // removed
    await expect(submitResponse(unsat(i.token, { dissatisfactionReason: "Too slow" }))).resolves.toBeTruthy();
  });

  it("starts with the seven default reasons, and a reason is ignored on a Satisfied answer", async () => {
    const i = await invite("INC-S2");
    expect((await getSurveyContext(i.token)).reasons).toEqual(DEFAULT_REASONS);
    await submitResponse({ token: i.token, satisfaction: "SATISFIED", dissatisfactionReason: "Other" });
    expect((await db.surveyResponse.findFirstOrThrow()).dissatisfactionReason).toBeNull();
  });
});

describe("settings", () => {
  it("rejects out-of-range values and keeps the old ones", async () => {
    await expect(saveSettings({ expiryDays: 0 })).rejects.toThrow();
    await expect(saveSettings({ maxFileMb: 500 })).rejects.toThrow();
    await expect(saveSettings({ allowedExtensions: ["exe" as never] })).rejects.toThrow();
    expect((await getSettings()).expiryDays).toBe(7);
  });

  it("link expiry follows the setting", async () => {
    await saveSettings({ expiryDays: 2 });
    const i = await invite("INC-E1");
    const days = (i.expiresAt.getTime() - Date.now()) / 86400_000;
    expect(days).toBeGreaterThan(1.99);
    expect(days).toBeLessThan(2.01);
  });
});

describe("survey page data", () => {
  it("shows request details from Helix but never the requester email or the agent", async () => {
    const { token } = await openSurveyForIncident({ incident: "INC-OK-9", key: "key-INC-OK-9" }, mockHelix);
    const ctx = await getSurveyContext(token);
    expect(ctx).toMatchObject({ incidentId: "INC-OK-9", supportGroup: "Service Desk", serviceName: "Network Access", requestSummary: "Cannot connect to the VPN from home" });
    expect(ctx.resolvedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(ctx)).not.toMatch(/example\.test|Test Agent/);
    expect(await db.surveyInvite.findUniqueOrThrow({ where: { token } })).toMatchObject({ assignedAgent: "Test Agent", priority: "Medium", category: "Network" });
  });

  it("hides the summary when the admin turns it off", async () => {
    const { token } = await openSurveyForIncident({ incident: "INC-OK-10", key: "key-INC-OK-10" }, mockHelix);
    await saveSettings({ showRequestSummary: false });
    expect((await getSurveyContext(token)).requestSummary).toBeNull();
  });

  it("still opens the survey when Helix cannot give the details", async () => {
    const noDetails = { getIncident: mockHelix.getIncident, getIncidentDetails: async () => { throw new Error("field not found"); } };
    const { token } = await openSurveyForIncident({ incident: "INC-OK-11", key: "key-INC-OK-11" }, noDetails);
    expect(await getSurveyContext(token)).toMatchObject({ incidentId: "INC-OK-11", requestSummary: null, serviceName: null });
  });
});

describe("who can open an attachment", () => {
  it("admin and the owning group yes; another group and management no", async () => {
    const i = await invite("INC-V1", "Network");
    await submitResponse(unsat(i.token), [png()]);
    const a = await db.surveyAttachment.findFirstOrThrow();
    const as = (role: "ADMIN" | "EXPERIENCE_TEAM" | "SUPPORT_GROUP" | "CIO", supportGroup: string | null) => findAttachmentForViewer({ role, supportGroup }, a.id);
    expect(await as("ADMIN", null)).not.toBeNull();
    expect(await as("EXPERIENCE_TEAM", null)).not.toBeNull();
    expect(await as("SUPPORT_GROUP", "Network")).not.toBeNull();
    expect(await as("SUPPORT_GROUP", "Service Desk")).toBeNull();
    expect(await as("SUPPORT_GROUP", null)).toBeNull();
    expect(await as("CIO", null)).toBeNull();
  });
});
