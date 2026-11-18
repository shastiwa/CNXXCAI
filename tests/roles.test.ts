import { rmSync } from "node:fs";
import path from "node:path";
import type { Role } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The routes read the login cookie through next/headers. Here the "browser" is this variable.
const jar = vi.hoisted(() => ({ session: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "session" && jar.session ? { value: jar.session } : undefined) }),
}));

import { GET as attachmentGet } from "@/app/api/attachments/[id]/route";
import { GET as casesGet } from "@/app/api/cases/route";
import { POST as retryPost } from "@/app/api/cases/[id]/retry/route";
import { GET as metricsGet } from "@/app/api/dashboard/metrics/route";
import { GET as responsesGet } from "@/app/api/responses/route";
import { GET as settingsGet } from "@/app/api/admin/settings/route";
import { PUT as userPut } from "@/app/api/admin/users/[id]/route";
import { POST as jobsPost } from "@/app/api/jobs/run/route";
import { GET as surveysGet } from "@/app/api/surveys/route";
import { POST as cancelPost } from "@/app/api/surveys/[id]/cancel/route";
import { POST as reopenPost } from "@/app/api/surveys/[id]/reopen/route";
import { signSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ALL_ROLES, SCOPE_BY_ROLE } from "@/lib/roles";
import { buildScopeFilters, getDashboardMetrics } from "@/services/metrics";
import { listResponses } from "@/services/responses";
import { createInvite, submitResponse } from "@/services/survey";
import { updateUser } from "@/services/users";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 1)]);
const UPLOADS = path.resolve(process.cwd(), ".test-uploads");
const mail = (r: string) => `roletest-${r.toLowerCase()}@example.test`;

type U = { id: string; role: Role };
const users = {} as Record<Role, U>;
let attachmentId = "";

async function wipeData() {
  await db.surveyAttachment.deleteMany();
  await db.recoveryCase.deleteMany();
  await db.surveyResponse.deleteMany();
  await db.incidentLink.deleteMany();
  await db.surveyInvite.deleteMany();
  rmSync(UPLOADS, { recursive: true, force: true });
}
async function wipeUsers() {
  const mine = await db.user.findMany({ where: { email: { startsWith: "roletest-" } }, select: { id: true } });
  await db.auditLog.deleteMany({ where: { actorId: { in: mine.map((u) => u.id) } } });
  await db.user.deleteMany({ where: { id: { in: mine.map((u) => u.id) } } });
}
const login = async (role: Role | null) => { jar.session = role ? await signSession(users[role].id) : undefined; };
const call = async (fn: () => Promise<Response>, role: Role | null) => { await login(role); return (await fn()).status; };
const req = (url = "http://localhost/x", init?: RequestInit) => new Request(url, init);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  await wipeData();
  await wipeUsers();
  for (const role of ALL_ROLES) {
    const u = await db.user.create({
      data: {
        email: mail(role), passwordHash: "not-a-real-hash", role,
        supportGroup: role === "SUPPORT_GROUP" ? "Network" : null,
        agentName: role === "SUPPORT_AGENT" ? "Test Agent" : null,
      },
    });
    users[role] = { id: u.id, role };
  }
  // One answered survey with a file: group Network, agent "Test Agent".
  const i = await createInvite({ incidentId: "INC-RM1", supportGroup: "Network", requesterEmail: "r@example.test", assignedAgent: "Test Agent" });
  await submitResponse({ token: i.token, satisfaction: "UNSATISFIED" }, [{ name: "s.png", bytes: PNG }]);
  attachmentId = (await db.surveyAttachment.findFirstOrThrow()).id;
});
afterAll(async () => { jar.session = undefined; await wipeData(); await wipeUsers(); });

describe("every role against every route", () => {
  // [route, expected status per role]. 200 = allowed, 403 = blocked.
  const matrix: [string, () => Promise<Response>, Record<Role, number>][] = [
    ["GET /api/dashboard/metrics", () => metricsGet(), { ADMIN: 200, EXPERIENCE_TEAM: 200, SERVICE_DELIVERY_MANAGER: 200, SUPPORT_GROUP: 200, SUPPORT_AGENT: 200, CIO: 200 }],
    ["GET /api/responses", () => responsesGet(req()), { ADMIN: 200, EXPERIENCE_TEAM: 200, SERVICE_DELIVERY_MANAGER: 200, SUPPORT_GROUP: 200, SUPPORT_AGENT: 200, CIO: 200 }],
    ["GET /api/cases", () => casesGet(), { ADMIN: 200, EXPERIENCE_TEAM: 200, SERVICE_DELIVERY_MANAGER: 403, SUPPORT_GROUP: 403, SUPPORT_AGENT: 403, CIO: 403 }],
    ["POST /api/cases/x/retry", () => retryPost(req(), ctx("nope")), { ADMIN: 404, EXPERIENCE_TEAM: 404, SERVICE_DELIVERY_MANAGER: 403, SUPPORT_GROUP: 403, SUPPORT_AGENT: 403, CIO: 403 }],
    ["GET /api/admin/settings", () => settingsGet(), { ADMIN: 200, EXPERIENCE_TEAM: 403, SERVICE_DELIVERY_MANAGER: 403, SUPPORT_GROUP: 403, SUPPORT_AGENT: 403, CIO: 403 }],
    ["PUT /api/admin/users/x", () => userPut(req("http://localhost/x", { method: "PUT", body: "{}" }), ctx("nope")), { ADMIN: 400, EXPERIENCE_TEAM: 403, SERVICE_DELIVERY_MANAGER: 403, SUPPORT_GROUP: 403, SUPPORT_AGENT: 403, CIO: 403 }],
    ["GET /api/surveys", () => surveysGet(req()), { ADMIN: 200, EXPERIENCE_TEAM: 200, SERVICE_DELIVERY_MANAGER: 200, SUPPORT_GROUP: 200, SUPPORT_AGENT: 200, CIO: 200 }],
    ["POST /api/surveys/x/cancel", () => cancelPost(req("http://localhost/x", { method: "POST", body: JSON.stringify({ reason: "test reason" }) }), ctx("nope")), { ADMIN: 404, EXPERIENCE_TEAM: 404, SERVICE_DELIVERY_MANAGER: 403, SUPPORT_GROUP: 403, SUPPORT_AGENT: 403, CIO: 403 }],
    ["POST /api/surveys/x/reopen", () => reopenPost(req("http://localhost/x", { method: "POST", body: JSON.stringify({ reason: "test reason" }) }), ctx("nope")), { ADMIN: 404, EXPERIENCE_TEAM: 404, SERVICE_DELIVERY_MANAGER: 403, SUPPORT_GROUP: 403, SUPPORT_AGENT: 403, CIO: 403 }],
    ["POST /api/jobs/run (signed in, no secret)", () => jobsPost(req("http://localhost/x", { method: "POST" })), { ADMIN: 200, EXPERIENCE_TEAM: 403, SERVICE_DELIVERY_MANAGER: 403, SUPPORT_GROUP: 403, SUPPORT_AGENT: 403, CIO: 403 }],
    ["GET /api/attachments/<file of group Network>", () => attachmentGet(req(), ctx(attachmentId)), { ADMIN: 200, EXPERIENCE_TEAM: 200, SERVICE_DELIVERY_MANAGER: 200, SUPPORT_GROUP: 200, SUPPORT_AGENT: 403, CIO: 403 }],
  ];

  it.each(matrix)("%s", async (_name, run, expected) => {
    for (const role of ALL_ROLES) expect({ role, status: await call(run, role) }).toEqual({ role, status: expected[role] });
    expect(await call(run, null)).toBe(401); // nobody signed in
  });

  it("a group manager from another group cannot open the file (404, same as missing)", async () => {
    const other = await db.user.create({ data: { email: mail("OTHERGROUP"), passwordHash: "x", role: "SUPPORT_GROUP", supportGroup: "Service Desk" } });
    jar.session = await signSession(other.id);
    expect((await attachmentGet(req(), ctx(attachmentId))).status).toBe(404);
  });

  it("a deactivated user is locked out at once", async () => {
    await db.user.update({ where: { id: users.ADMIN.id }, data: { active: false } });
    expect(await call(() => metricsGet(), "ADMIN")).toBe(401);
    await db.user.update({ where: { id: users.ADMIN.id }, data: { active: true } });
  });

  it("downloads send the file as an attachment and are never sniffed", async () => {
    await login("SERVICE_DELIVERY_MANAGER");
    const res = await attachmentGet(req(), ctx(attachmentId));
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
  });
});

describe("what each role sees", () => {
  beforeEach(async () => {
    // A second survey: other group, other agent.
    const extra = ["INC-RM2", "INC-RM3"];
    await db.surveyAttachment.deleteMany({ where: { response: { invite: { incidentId: { in: extra } } } } });
    await db.recoveryCase.deleteMany({ where: { response: { invite: { incidentId: { in: extra } } } } });
    await db.surveyResponse.deleteMany({ where: { invite: { incidentId: { in: extra } } } });
    await db.surveyInvite.deleteMany({ where: { incidentId: { in: extra } } });
    const j = await createInvite({ incidentId: "INC-RM2", supportGroup: "Service Desk", requesterEmail: "s@example.test", assignedAgent: "Other Agent" });
    await submitResponse({ token: j.token, satisfaction: "SATISFIED" });
  });

  const view = (role: Role, over: object = {}) => ({ role, supportGroup: null, agentName: null, ...over });
  const ids = async (v: ReturnType<typeof view>) => (await listResponses(v)).map((r) => r.incidentId).sort();

  it("all-scope roles see both surveys; email only for Admin and Experience Team", async () => {
    for (const role of ["ADMIN", "EXPERIENCE_TEAM", "SERVICE_DELIVERY_MANAGER", "CIO"] as Role[]) {
      expect(await ids(view(role))).toEqual(["INC-RM1", "INC-RM2"]);
    }
    const emailFor = async (role: Role) => (await listResponses(view(role)))[0].requesterEmail;
    expect(await emailFor("ADMIN")).not.toBeNull();
    expect(await emailFor("EXPERIENCE_TEAM")).not.toBeNull();
    expect(await emailFor("SERVICE_DELIVERY_MANAGER")).toBeNull();
    expect(await emailFor("CIO")).toBeNull();
  });

  it("a support agent sees only surveys that name them, never email or files", async () => {
    const rows = await listResponses(view("SUPPORT_AGENT", { agentName: "Test Agent" }));
    expect(rows.map((r) => r.incidentId)).toEqual(["INC-RM1"]);
    expect(rows[0]).toMatchObject({ requesterEmail: null, attachments: [], attachmentCount: 1 });
    expect(await ids(view("SUPPORT_AGENT", { agentName: "Other Agent" }))).toEqual(["INC-RM2"]);
  });

  it("a support agent with no agent name, or an unknown one, sees nothing", async () => {
    // A survey whose agent text is blank must not match an agent user whose name is blank.
    const blank = await createInvite({ incidentId: "INC-RM3", supportGroup: "Network", requesterEmail: "b@example.test", assignedAgent: "" });
    await submitResponse({ token: blank.token, satisfaction: "SATISFIED" });
    expect(await ids(view("SUPPORT_AGENT"))).toEqual([]);
    expect(await ids(view("SUPPORT_AGENT", { agentName: "" }))).toEqual([]);
    expect(await ids(view("SUPPORT_AGENT", { agentName: "Nobody" }))).toEqual([]);
  });

  it("group manager sees their group; dashboard numbers follow the same scope", async () => {
    expect(await ids(view("SUPPORT_GROUP", { supportGroup: "Network" }))).toEqual(["INC-RM1"]);
    expect(await getDashboardMetrics(view("SUPPORT_AGENT", { agentName: "Test Agent" }))).toMatchObject({ invites: 1, responses: 1, unsatisfied: 1 });
    expect(await getDashboardMetrics(view("SUPPORT_AGENT", { agentName: "Nobody" }))).toMatchObject({ invites: 0, responses: 0 });
    expect(await getDashboardMetrics(view("SERVICE_DELIVERY_MANAGER"))).toMatchObject({ invites: 2, responses: 2 });
  });

  it("fails closed: a role with no scope rule sees nothing", async () => {
    expect(await ids(view("MYSTERY" as Role))).toEqual([]);
    expect(buildScopeFilters(view("MYSTERY" as Role)).invite).toEqual({ id: "__none__" });
  });

  it("every role has an explicit scope rule", () => {
    expect(Object.keys(SCOPE_BY_ROLE).sort()).toEqual([...ALL_ROLES].sort());
  });
});

describe("admin edits a user", () => {
  const put = async (target: Role, body: object, as: Role = "ADMIN") => {
    await login(as);
    const res = await userPut(req("http://localhost/x", { method: "PUT", body: JSON.stringify(body) }), ctx(users[target].id));
    return { status: res.status, body: await res.json() };
  };
  const cur = (r: Role) => db.user.findUniqueOrThrow({ where: { id: users[r].id } });

  it("changes role, and group or agent name only where the role uses them", async () => {
    let r = await put("CIO", { role: "SUPPORT_AGENT", agentName: "  New Agent  ", supportGroup: "ignored", active: true });
    expect(r.status).toBe(200);
    expect(await cur("CIO")).toMatchObject({ role: "SUPPORT_AGENT", agentName: "New Agent", supportGroup: null });
    r = await put("CIO", { role: "CIO", active: true });
    expect(await cur("CIO")).toMatchObject({ role: "CIO", agentName: null });
    expect((await db.auditLog.findMany({ where: { action: "user.update", target: users.CIO.id } })).length).toBeGreaterThanOrEqual(2);
  });

  it("refuses bad input and writes nothing", async () => {
    expect((await put("CIO", { role: "SUPPORT_GROUP", active: true })).status).toBe(400); // group missing
    expect((await put("CIO", { role: "SUPPORT_AGENT", agentName: "  ", active: true })).status).toBe(400); // name blank
    expect((await put("CIO", { role: "KING", active: true })).status).toBe(400); // unknown role
    expect((await put("CIO", { role: "CIO", active: true, passwordHash: "x" })).status).toBe(400); // extra field
    expect((await cur("CIO")).role).toBe("CIO");
  });

  it("an admin cannot edit themselves", async () => {
    expect((await put("ADMIN", { role: "CIO", active: true })).status).toBe(400);
    expect((await put("ADMIN", { role: "ADMIN", active: false })).status).toBe(400);
    expect(await cur("ADMIN")).toMatchObject({ role: "ADMIN", active: true });
  });

  it("another admin can demote an admin while one admin remains", async () => {
    const second = await db.user.create({ data: { email: mail("ADMIN2"), passwordHash: "x", role: "ADMIN" } });
    jar.session = await signSession(second.id);
    const body = JSON.stringify({ role: "CIO", active: true });
    expect((await userPut(req("http://localhost/x", { method: "PUT", body }), ctx(users.ADMIN.id))).status).toBe(200);
    await db.user.update({ where: { id: users.ADMIN.id }, data: { role: "ADMIN" } }); // restore
  });

  it("the last active admin cannot be demoted or deactivated (checked in the service, as a second safety net)", async () => {
    // The API cannot reach this (an acting admin is always another active admin), so call the service directly.
    const outsider = users.CIO; // any id that is not the target
    await db.user.updateMany({ where: { role: "ADMIN", id: { not: users.ADMIN.id } }, data: { active: false } });
    await expect(updateUser(outsider, users.ADMIN.id, { role: "CIO", active: true })).rejects.toMatchObject({ status: 409 });
    await expect(updateUser(outsider, users.ADMIN.id, { role: "ADMIN", active: false })).rejects.toMatchObject({ status: 409 });
    expect(await cur("ADMIN")).toMatchObject({ role: "ADMIN", active: true });
  });
});
