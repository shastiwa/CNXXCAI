import { rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Lets one test pretend no reminder delivery method is configured.
const mode = vi.hoisted(() => ({ off: false }));
vi.mock("@/connectors/reminder", async (orig) => {
  const m = await orig<typeof import("@/connectors/reminder")>();
  return { ...m, reminderSender: () => (mode.off ? null : m.reminderSender()) };
});

// Runs a function at the moment submitResponse checks the reason list, which is after the survey was loaded
// and before the answer is saved. That is the gap a cancel can slip into.
const gap = vi.hoisted(() => ({ run: null as null | (() => Promise<void>) }));
vi.mock("@/services/reasons", async (orig) => {
  const m = await orig<typeof import("@/services/reasons")>();
  return { ...m, getActiveReasons: async () => { await gap.run?.(); return m.getActiveReasons(); } };
});

import { POST as jobsPost } from "@/app/api/jobs/run/route";
import { mockOutbox } from "@/connectors/reminder";
import { db } from "@/lib/db";
import { cancelInvite, moveStatus, reopenInvite, runLifecycleJobs } from "@/services/lifecycle";
import { getDashboardMetrics } from "@/services/metrics";
import { saveSettings } from "@/services/settings";
import { createInvite, getSurveyContext, submitResponse } from "@/services/survey";
import { listSurveys } from "@/services/tracking";

const UPLOADS = path.resolve(process.cwd(), ".test-uploads");
let actor: { id: string };
const DAY = 86400_000;

const mk = async (incidentId: string, opts: { sent?: boolean; agent?: string; group?: string } = {}) => {
  const i = await createInvite(
    { incidentId, supportGroup: opts.group ?? "Network", requesterEmail: "r@example.test", assignedAgent: opts.agent },
    { handedToHelix: opts.sent ?? false },
  );
  return db.surveyInvite.findUniqueOrThrow({ where: { token: i.token } });
};
const get = (id: string) => db.surveyInvite.findUniqueOrThrow({ where: { id } });
const trail = async (id: string) => (await db.surveyStatusEvent.findMany({ where: { inviteId: id }, orderBy: { createdAt: "asc" } })).map((e) => `${e.fromStatus ?? "-"}>${e.toStatus}`);

async function wipe() {
  await db.surveyAttachment.deleteMany();
  await db.recoveryCase.deleteMany();
  await db.surveyResponse.deleteMany();
  await db.incidentLink.deleteMany();
  await db.surveyInvite.deleteMany();
  rmSync(UPLOADS, { recursive: true, force: true });
}

beforeAll(async () => {
  await db.auditLog.deleteMany({ where: { actor: { email: "lifecycle@example.test" } } });
  await db.user.deleteMany({ where: { email: "lifecycle@example.test" } });
  actor = await db.user.create({ data: { email: "lifecycle@example.test", passwordHash: "x", role: "EXPERIENCE_TEAM" } });
});
afterAll(async () => {
  await wipe();
  await db.auditLog.deleteMany({ where: { actorId: actor.id } });
  await db.user.delete({ where: { id: actor.id } });
  await db.appSetting.deleteMany();
});
beforeEach(async () => {
  await wipe();
  await db.appSetting.deleteMany();
  mockOutbox.sent.length = 0;
  mockOutbox.failNext = false;
  mode.off = false;
});

describe("status history", () => {
  it("records created, sent, viewed once, and responded in order", async () => {
    const inv = await mk("INC-L1", { sent: true });
    await getSurveyContext(inv.token);
    await getSurveyContext(inv.token); // second open must not add an event
    await submitResponse({ token: inv.token, satisfaction: "SATISFIED" });
    expect(await trail(inv.id)).toEqual(["->PENDING", "PENDING>SENT", "SENT>VIEWED", "VIEWED>RESPONDED"]);
    const now = await get(inv.id);
    expect(now.status).toBe("RESPONDED");
    expect(now.sentAt).not.toBeNull();
    expect(now.viewedAt).not.toBeNull();
  });

  it("a survey answered without being opened goes straight to RESPONDED", async () => {
    const inv = await mk("INC-L2");
    await submitResponse({ token: inv.token, satisfaction: "SATISFIED" });
    expect(await trail(inv.id)).toEqual(["->PENDING", "PENDING>RESPONDED"]);
  });

  it("refuses moves the rules do not allow and writes no history", async () => {
    const inv = await mk("INC-L3");
    await submitResponse({ token: inv.token, satisfaction: "SATISFIED" });
    expect(await moveStatus(db, inv.id, "VIEWED")).toBe(false); // an answered survey is final
    expect(await moveStatus(db, inv.id, "CANCELLED")).toBe(false);
    expect((await get(inv.id)).status).toBe("RESPONDED");
    expect(await trail(inv.id)).toEqual(["->PENDING", "PENDING>RESPONDED"]);
  });
});

describe("cancel", () => {
  it("a cancelled survey cannot be opened or answered", async () => {
    const inv = await mk("INC-C1", { sent: true });
    await cancelInvite(actor, inv.id, { reason: "Raised by mistake" });
    await expect(getSurveyContext(inv.token)).rejects.toMatchObject({ status: 410 });
    await expect(submitResponse({ token: inv.token, satisfaction: "SATISFIED" })).rejects.toMatchObject({ status: 410 });
    expect(await db.surveyResponse.count()).toBe(0);
    expect(await trail(inv.id)).toEqual(["->PENDING", "PENDING>SENT", "SENT>CANCELLED"]);
    expect((await db.auditLog.findFirst({ where: { action: "survey.cancel", target: inv.id } }))?.detail).toBe("Raised by mistake");
  });

  it("needs a reason, and an answered survey cannot be cancelled", async () => {
    const inv = await mk("INC-C2");
    await expect(cancelInvite(actor, inv.id, { reason: " " })).rejects.toThrow();
    await expect(cancelInvite(actor, inv.id, {})).rejects.toThrow();
    expect((await get(inv.id)).status).toBe("PENDING");
    await submitResponse({ token: inv.token, satisfaction: "SATISFIED" });
    await expect(cancelInvite(actor, inv.id, { reason: "too late" })).rejects.toMatchObject({ status: 409 });
    await expect(cancelInvite(actor, "missing", { reason: "no such" })).rejects.toMatchObject({ status: 404 });
  });

  it("an answer that arrives after the survey was cancelled is rejected and keeps no files or response", async () => {
    // The survey is loaded as open, then cancelled, then the answer is saved: the save must refuse.
    const inv = await mk("INC-C3");
    gap.run = async () => { gap.run = null; await cancelInvite(actor, inv.id, { reason: "Withdrawn" }); };
    await expect(submitResponse({ token: inv.token, satisfaction: "UNSATISFIED", dissatisfactionReason: "Other" })).rejects.toMatchObject({ status: 409 });
    expect(await db.surveyResponse.count()).toBe(0);
    expect(await db.recoveryCase.count()).toBe(0);
    expect((await get(inv.id)).status).toBe("CANCELLED");
  });
});

describe("expiry job", () => {
  it("expires overdue open surveys once, and leaves answered and future ones alone", async () => {
    const late = await mk("INC-E1", { sent: true });
    const fine = await mk("INC-E2", { sent: true });
    const done = await mk("INC-E3");
    await submitResponse({ token: done.token, satisfaction: "SATISFIED" });
    await db.surveyInvite.updateMany({ where: { id: { in: [late.id, done.id] } }, data: { expiresAt: new Date(Date.now() - DAY) } });

    expect((await runLifecycleJobs()).expired).toBe(1);
    expect((await get(late.id)).status).toBe("EXPIRED");
    expect((await get(fine.id)).status).toBe("SENT");
    expect((await get(done.id)).status).toBe("RESPONDED");
    expect((await runLifecycleJobs()).expired).toBe(0); // running again changes nothing
    expect(await trail(late.id)).toEqual(["->PENDING", "PENDING>SENT", "SENT>EXPIRED"]);
  });
});

describe("reopen", () => {
  it("an answered survey gets a new survey; the old answer stays; the Helix link opens the new one", async () => {
    const inv = await mk("INC-R1");
    await db.incidentLink.create({ data: { incidentId: "INC-R1", inviteId: inv.id } });
    await submitResponse({ token: inv.token, satisfaction: "UNSATISFIED" });

    const res = await reopenInvite(actor, inv.id, { reason: "Requester pressed the wrong button" });
    const old = await get(inv.id);
    expect(old.status).toBe("RESPONDED");
    expect(old.replacedById).not.toBeNull();
    expect(await db.surveyResponse.count({ where: { inviteId: inv.id } })).toBe(1);
    const fresh = await get(old.replacedById!);
    expect(fresh).toMatchObject({ token: res.token, status: "PENDING", reopenedFromId: inv.id, incidentId: "INC-R1" });
    expect((await db.incidentLink.findUniqueOrThrow({ where: { incidentId: "INC-R1" } })).inviteId).toBe(fresh.id);

    await submitResponse({ token: res.token, satisfaction: "SATISFIED" });
    expect(await db.surveyResponse.count()).toBe(2);
    // The dashboard counts the incident once, by its latest answer.
    expect(await getDashboardMetrics({ role: "ADMIN", supportGroup: null })).toMatchObject({ invites: 1, responses: 1, satisfied: 1, unsatisfied: 0 });
  });

  it("the same survey cannot be reopened twice, and the reopen limit is enforced", async () => {
    const inv = await mk("INC-R2");
    await submitResponse({ token: inv.token, satisfaction: "SATISFIED" });
    const first = await reopenInvite(actor, inv.id, { reason: "first reopen" });
    await expect(reopenInvite(actor, inv.id, { reason: "again" })).rejects.toMatchObject({ status: 409 });
    expect(await db.surveyInvite.count({ where: { incidentId: "INC-R2" } })).toBe(2);

    await submitResponse({ token: first.token, satisfaction: "SATISFIED" });
    const secondId = (await db.surveyInvite.findUniqueOrThrow({ where: { token: first.token } })).id;
    await expect(reopenInvite(actor, secondId, { reason: "over the limit" })).rejects.toMatchObject({ status: 409 }); // default limit is 1
    await saveSettings({ maxReopens: 2 });
    await expect(reopenInvite(actor, secondId, { reason: "limit raised" })).resolves.toBeTruthy();
    await saveSettings({ maxReopens: 0 });
    const third = await mk("INC-R2B");
    await submitResponse({ token: third.token, satisfaction: "SATISFIED" });
    await expect(reopenInvite(actor, third.id, { reason: "not allowed at all" })).rejects.toMatchObject({ status: 409 });
  });

  it("needs a reason, and an open survey cannot be reopened", async () => {
    const inv = await mk("INC-R3", { sent: true });
    await expect(reopenInvite(actor, inv.id, { reason: "still open" })).rejects.toMatchObject({ status: 409 });
    await db.surveyInvite.update({ where: { id: inv.id }, data: { status: "EXPIRED" } });
    await expect(reopenInvite(actor, inv.id, {})).rejects.toThrow();
    expect((await get(inv.id)).status).toBe("EXPIRED");
  });

  it("an expired or cancelled survey is reopened in place with a new expiry and reminder count", async () => {
    const inv = await mk("INC-R4", { sent: true });
    await db.surveyInvite.update({ where: { id: inv.id }, data: { reminderCount: 2, expiresAt: new Date(Date.now() - DAY) } });
    await runLifecycleJobs();
    expect((await get(inv.id)).status).toBe("EXPIRED");
    await expect(getSurveyContext(inv.token)).rejects.toMatchObject({ status: 410 });

    await reopenInvite(actor, inv.id, { reason: "Requester was on leave" });
    const now = await get(inv.id);
    expect(now).toMatchObject({ status: "SENT", reminderCount: 0 });
    expect(now.expiresAt.getTime()).toBeGreaterThan(Date.now());
    await expect(getSurveyContext(inv.token)).resolves.toBeTruthy();

    await cancelInvite(actor, inv.id, { reason: "changed mind" });
    await reopenInvite(actor, inv.id, { reason: "changed mind again" });
    expect((await get(inv.id)).status).toBe("SENT");
  });
});

describe("reminders", () => {
  const enable = (over: object = {}) => saveSettings({ remindersEnabled: true, reminderAfterDays: 3, maxReminders: 2, ...over });
  const age = (id: string, days: number) => db.surveyInvite.update({ where: { id }, data: { sentAt: new Date(Date.now() - days * DAY) } });

  it("sends nothing while reminders are turned off in settings", async () => {
    const inv = await mk("INC-M1", { sent: true });
    await age(inv.id, 10);
    const r = await runLifecycleJobs();
    expect(r.reminders).toMatchObject({ enabled: false, due: 0, sent: 0 });
    expect(mockOutbox.sent).toHaveLength(0);
  });

  it("sends a reminder when due, then waits, then stops at the maximum", async () => {
    await enable();
    const inv = await mk("INC-M2", { sent: true });
    await age(inv.id, 1);
    expect((await runLifecycleJobs()).reminders.due).toBe(0); // only 1 day old

    await age(inv.id, 4);
    const r1 = await runLifecycleJobs();
    expect(r1.reminders).toMatchObject({ due: 1, sent: 1, failed: 0 });
    expect(mockOutbox.sent).toHaveLength(1);
    expect(mockOutbox.sent[0]).toMatchObject({ incidentId: "INC-M2", number: 1, to: "r@example.test" });
    expect(mockOutbox.sent[0].link).toContain(`/survey/${inv.token}`);
    expect((await runLifecycleJobs()).reminders.sent).toBe(0); // just reminded: not due again

    await db.surveyInvite.update({ where: { id: inv.id }, data: { lastReminderAt: new Date(Date.now() - 4 * DAY) } });
    expect((await runLifecycleJobs()).reminders.sent).toBe(1); // second reminder
    await db.surveyInvite.update({ where: { id: inv.id }, data: { lastReminderAt: new Date(Date.now() - 4 * DAY) } });
    expect((await runLifecycleJobs()).reminders.sent).toBe(0); // maximum of 2 reached
    expect(mockOutbox.sent).toHaveLength(2);
    expect((await get(inv.id)).reminderCount).toBe(2);
    expect((await trail(inv.id)).filter((t) => t === "SENT>SENT")).toHaveLength(2);
  });

  it("never reminds answered, cancelled, expired or not-yet-sent surveys", async () => {
    await enable();
    const answered = await mk("INC-M3", { sent: true });
    const cancelled = await mk("INC-M4", { sent: true });
    const unsent = await mk("INC-M5"); // PENDING: link never handed out
    await submitResponse({ token: answered.token, satisfaction: "SATISFIED" });
    await cancelInvite(actor, cancelled.id, { reason: "not needed" });
    for (const i of [answered, cancelled, unsent]) await db.surveyInvite.update({ where: { id: i.id }, data: { sentAt: new Date(Date.now() - 10 * DAY), createdAt: new Date(Date.now() - 10 * DAY) } });
    expect((await runLifecycleJobs()).reminders).toMatchObject({ due: 0, sent: 0 });
  });

  it("a failed delivery is not counted and is tried again at the next run", async () => {
    await enable();
    const inv = await mk("INC-M6", { sent: true });
    await age(inv.id, 5);
    mockOutbox.failNext = true;
    const r = await runLifecycleJobs();
    expect(r.reminders).toMatchObject({ due: 1, sent: 0, failed: 1 });
    expect((await get(inv.id)).reminderCount).toBe(0);
    expect((await trail(inv.id)).length).toBe(3); // created, sent, failure note
    expect((await runLifecycleJobs()).reminders).toMatchObject({ sent: 1, failed: 0 });
    expect((await get(inv.id)).reminderCount).toBe(1);
  });

  it("with no delivery method it reports what is due and sends and counts nothing", async () => {
    await enable();
    mode.off = true;
    const inv = await mk("INC-M7", { sent: true });
    await age(inv.id, 5);
    const r = await runLifecycleJobs();
    expect(r.reminders).toMatchObject({ due: 1, sent: 0, failed: 0 });
    expect(r.reminders.note).toMatch(/no reminder delivery method/i);
    expect((await get(inv.id)).reminderCount).toBe(0);
  });
});

describe("job endpoint secret", () => {
  const call = (secret: string | null) =>
    jobsPost(new Request("http://localhost/api/jobs/run", { method: "POST", headers: secret === null ? {} : { "x-jobs-secret": secret } }));

  it("accepts the scheduler secret and refuses a wrong or empty one", async () => {
    expect((await call("test-jobs-secret-1234")).status).toBe(200);
    expect((await call("wrong-secret-value-xx")).status).toBe(401);
    expect((await call("")).status).toBe(401);
  });
});

describe("survey list", () => {
  it("shows history to everyone in scope, but staff names and email only to managers", async () => {
    const inv = await mk("INC-V1", { sent: true, agent: "Test Agent" });
    await cancelInvite(actor, inv.id, { reason: "demo" });
    const v = (role: "ADMIN" | "SERVICE_DELIVERY_MANAGER" | "SUPPORT_AGENT", over: object = {}) => ({ role, supportGroup: null, agentName: null, ...over });

    const admin = (await listSurveys(v("ADMIN")))[0];
    expect(admin.requesterEmail).not.toBeNull();
    expect(admin.history.at(-1)?.by).toBe("lifecycle@example.test");

    const sdm = (await listSurveys(v("SERVICE_DELIVERY_MANAGER")))[0];
    expect(sdm.requesterEmail).toBeNull();
    expect(sdm.history.at(-1)?.by).toBe("Staff");
    expect(sdm.history[0].by).toBe("System");

    expect((await listSurveys(v("SUPPORT_AGENT", { agentName: "Test Agent" }))).map((s) => s.incidentId)).toEqual(["INC-V1"]);
    expect(await listSurveys(v("SUPPORT_AGENT", { agentName: "Somebody Else" }))).toEqual([]);
    expect(await listSurveys(v("SUPPORT_AGENT"))).toEqual([]);
    expect(await listSurveys(v("ADMIN"), { status: "RESPONDED" })).toEqual([]);
  });
});
