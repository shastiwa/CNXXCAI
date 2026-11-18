import ExcelJS from "exceljs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { getAnalytics, getFilterOptions, loadRows, parseFilters, trend, type Filters } from "@/services/analytics";
import { buildWorkbook, safeCell } from "@/services/export";
import { saveSettings } from "@/services/settings";

const H = 3600_000;
const T0 = Date.UTC(2026, 2, 2, 10); // Monday 2026-03-02 10:00 UTC
type V = { role: "ADMIN" | "SUPPORT_GROUP" | "SUPPORT_AGENT" | "SERVICE_DELIVERY_MANAGER" | "CIO"; supportGroup: string | null; agentName: string | null };
const admin: V = { role: "ADMIN", supportGroup: null, agentName: null };
const f = (over: object = {}) => parseFilters(Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])));

interface Seed {
  inc: string; group?: string; service?: string | null; category?: string | null; agent?: string | null; priority?: string;
  at: number; // survey created
  answer?: "SATISFIED" | "UNSATISFIED"; afterH?: number; status?: "SENT" | "CANCELLED" | "EXPIRED"; expired?: boolean; replaced?: boolean;
  caseStatus?: "PENDING" | "CREATED"; loss?: number;
}
async function seed(s: Seed) {
  const created = new Date(s.at);
  const inv = await db.surveyInvite.create({
    data: {
      token: `tok-${s.inc}`, incidentId: s.inc, supportGroup: s.group ?? "Network", requesterEmail: "r@example.test",
      serviceName: s.service === undefined ? "VPN" : s.service, category: s.category === undefined ? "Access" : s.category,
      assignedAgent: s.agent === undefined ? "Agent A" : s.agent, priority: s.priority ?? "P3",
      createdAt: created, sentAt: created, status: s.answer ? "RESPONDED" : s.status ?? "SENT",
      expiresAt: new Date(s.expired ? s.at + H : s.at + 3650 * 24 * H), replacedById: s.replaced ? "other" : null,
    },
  });
  if (s.answer) {
    const r = await db.surveyResponse.create({
      data: { inviteId: inv.id, satisfaction: s.answer, createdAt: new Date(s.at + (s.afterH ?? 1) * H), productivityLossMin: s.loss },
    });
    if (s.caseStatus) await db.recoveryCase.create({ data: { responseId: r.id, assignedTeam: "x", status: s.caseStatus } });
  }
}
async function wipe() {
  await db.recoveryCase.deleteMany(); await db.surveyResponse.deleteMany(); await db.incidentLink.deleteMany(); await db.surveyInvite.deleteMany();
}
beforeAll(wipe);
afterAll(async () => { await wipe(); await db.appSetting.deleteMany(); });
beforeEach(async () => { await wipe(); await db.appSetting.deleteMany(); });

describe("KPIs", () => {
  it("counts answers, rates, open, expired, cancelled, average time and waiting cases", async () => {
    await seed({ inc: "A1", at: T0, answer: "SATISFIED", afterH: 6, loss: 30 });
    await seed({ inc: "A2", at: T0, answer: "UNSATISFIED", afterH: 2, caseStatus: "PENDING", loss: 10 });
    await seed({ inc: "A3", at: T0, answer: "UNSATISFIED", afterH: 4, caseStatus: "CREATED" });
    await seed({ inc: "A4", at: T0 }); // open
    await seed({ inc: "A5", at: T0, status: "EXPIRED" });
    await seed({ inc: "A6", at: T0, expired: true }); // still SENT but past its expiry: counts as expired
    await seed({ inc: "A7", at: T0, status: "CANCELLED" });
    const k = (await getAnalytics(admin, f())).kpis;
    expect(k).toMatchObject({
      surveys: 7, responses: 3, satisfied: 1, unsatisfied: 2, pending: 1, expired: 2, cancelled: 1,
      responseRatePct: 42.9, satisfactionPct: 33.3, dissatisfactionPct: 66.7, avgResponseHours: 4, casesWaiting: 1, minutesLost: 40,
    });
  });

  it("shows nulls, not zeros or NaN, when there is nothing to divide by", async () => {
    await seed({ inc: "B1", at: T0 });
    const k = (await getAnalytics(admin, f())).kpis;
    expect(k).toMatchObject({ surveys: 1, responses: 0, responseRatePct: 0, satisfactionPct: null, dissatisfactionPct: null, avgResponseHours: null });
    expect((await getAnalytics(admin, f({ group: "Nobody" }))).kpis).toMatchObject({ surveys: 0, responseRatePct: null });
  });

  it("counts a reopened incident once: replaced surveys are left out", async () => {
    await seed({ inc: "C1", at: T0, answer: "UNSATISFIED", replaced: true });
    await seed({ inc: "C1b", at: T0, answer: "SATISFIED" });
    expect((await getAnalytics(admin, f())).kpis).toMatchObject({ surveys: 1, responses: 1, satisfied: 1 });
  });
});

describe("who sees what", () => {
  it("a group manager and an agent only get their own surveys, and options never list other groups", async () => {
    await seed({ inc: "D1", at: T0, answer: "SATISFIED", group: "Network", agent: "Agent A" });
    await seed({ inc: "D2", at: T0, answer: "SATISFIED", group: "Service Desk", agent: "Agent B", service: "Email" });
    const grp: V = { role: "SUPPORT_GROUP", supportGroup: "Network", agentName: null };
    const agt: V = { role: "SUPPORT_AGENT", supportGroup: null, agentName: "Agent B" };
    expect((await getAnalytics(grp, f())).kpis.surveys).toBe(1);
    expect((await getAnalytics(agt, f())).byService.map((r) => r.name)).toEqual(["Email"]);
    expect((await getFilterOptions(grp)).groups).toEqual(["Network"]);
    expect((await getFilterOptions(agt)).agents).toEqual([]); // an agent has nobody to compare with
    expect((await getFilterOptions(admin)).agents).toEqual(["Agent A", "Agent B"]);
    // Filtering for someone else's data returns nothing, not their data.
    expect((await getAnalytics(grp, f({ group: "Service Desk" }))).kpis.surveys).toBe(0);
    expect((await getAnalytics(agt, f({ agent: "Agent A" }))).kpis.surveys).toBe(0);
  });

  it("a role with no scope rule and an agent with no name see nothing", async () => {
    await seed({ inc: "E1", at: T0, answer: "SATISFIED" });
    expect((await getAnalytics({ role: "MYSTERY", supportGroup: null, agentName: null } as unknown as V, f())).kpis.surveys).toBe(0);
    expect((await getAnalytics({ role: "SUPPORT_AGENT", supportGroup: null, agentName: "" }, f())).kpis.surveys).toBe(0);
  });
});

describe("filters", () => {
  it("date range includes the whole 'to' day, and group, service and unknown filters match exactly", async () => {
    const day = (n: number) => Date.UTC(2026, 2, n, 23, 30);
    await seed({ inc: "F1", at: day(1) }); await seed({ inc: "F2", at: day(2) }); await seed({ inc: "F3", at: day(3) });
    await seed({ inc: "F4", at: day(2), service: null, agent: "" });
    await seed({ inc: "F5", at: day(2), service: "Email", group: "Service Desk", priority: "P1" });
    const n = async (o: object) => (await getAnalytics(admin, f(o))).kpis.surveys;
    expect(await n({ from: "2026-03-02", to: "2026-03-02" })).toBe(3); // F2, F4, F5 (23:30 is still that day)
    expect(await n({ from: "2026-03-03" })).toBe(1);
    expect(await n({ to: "2026-03-01" })).toBe(1);
    expect(await n({ service: "(unknown)" })).toBe(1); // null service
    expect(await n({ agent: "(unknown)" })).toBe(1); // blank agent text
    expect(await n({ service: "Email" })).toBe(1);
    expect(await n({ group: "Service Desk", priority: "P1" })).toBe(1);
    expect(await n({ group: "Service Desk", priority: "P3" })).toBe(0);
  });

  it("refuses bad input", () => {
    // Must be a ZodError (the routes turn that into 400); any other error would be a 500.
    expect(() => f({ from: "2026-13-40" })).toThrow(ZodError);
    expect(() => f({ from: "nope" })).toThrow(ZodError);
    expect(() => f({ from: "2026-02-30" })).toThrow(ZodError);
    expect(() => f({ from: "2026-03-05", to: "2026-03-01" })).toThrow(ZodError);
    expect(() => f({ grain: "hour" })).toThrow(ZodError);
    expect(() => f({ evil: "1" })).toThrow(ZodError); // unknown parameter
    expect(() => parseFilters(new URLSearchParams("group=" + "x".repeat(201)))).toThrow(ZodError);
    expect(parseFilters(new URLSearchParams("from=&group=")).grain).toBe("week"); // empty values are ignored
  });
});

describe("minimum answers", () => {
  it("hides the score below the minimum and shows it once enough answers exist", async () => {
    for (let i = 0; i < 4; i++) await seed({ inc: `G${i}`, at: T0, answer: i < 3 ? "SATISFIED" : "UNSATISFIED", agent: "Agent A" });
    for (let i = 4; i < 10; i++) await seed({ inc: `G${i}`, at: T0, answer: "SATISFIED", agent: "Agent B" });
    let a = await getAnalytics(admin, f());
    expect(a.minResponses).toBe(5);
    expect(a.byAgent.find((r) => r.name === "Agent A")).toMatchObject({ responses: 4, satisfactionPct: null, enough: false });
    expect(a.byAgent.find((r) => r.name === "Agent B")).toMatchObject({ responses: 6, satisfactionPct: 100, enough: true });
    await saveSettings({ minResponses: 4 });
    a = await getAnalytics(admin, f());
    expect(a.byAgent.find((r) => r.name === "Agent A")).toMatchObject({ satisfactionPct: 75, enough: true });
  });

  it("heatmap cells below the minimum carry no percentage", async () => {
    for (let i = 0; i < 5; i++) await seed({ inc: `H${i}`, at: T0, answer: i < 2 ? "UNSATISFIED" : "SATISFIED", group: "Network", service: "VPN" });
    await seed({ inc: "H9", at: T0, answer: "UNSATISFIED", group: "Network", service: "Email" });
    const h = (await getAnalytics(admin, f())).heatmap;
    const cell = (g: string, s: string) => h.cells[h.groups.indexOf(g)][h.services.indexOf(s)];
    expect(cell("Network", "VPN")).toMatchObject({ responses: 5, unsatisfied: 2, dissatisfactionPct: 40, enough: true });
    expect(cell("Network", "Email")).toMatchObject({ responses: 1, dissatisfactionPct: null, enough: false });
  });
});

describe("trends", () => {
  const rowsAt = (...ds: string[]) => ds.map((d) => ({ createdAt: new Date(`${d}T12:00:00Z`), response: null })) as never;

  it("buckets by day, week (Monday), month, quarter and year, and keeps empty periods", () => {
    const rows = rowsAt("2026-03-01", "2026-03-09"); // Sunday and the Monday after
    expect(trend(rows, "day")).toHaveLength(9);
    expect(trend(rows, "week").map((p) => p.period)).toEqual(["2026-02-23", "2026-03-02", "2026-03-09"]); // Sunday belongs to the week of Feb 23
    expect(trend(rows, "week").map((p) => p.surveys)).toEqual([1, 0, 1]);
    expect(trend(rowsAt("2026-01-31", "2026-03-01"), "month").map((p) => p.period)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(trend(rowsAt("2025-12-31", "2026-04-01"), "quarter").map((p) => p.period)).toEqual(["2025-Q4", "2026-Q1", "2026-Q2"]);
    expect(trend(rowsAt("2024-06-01", "2026-06-01"), "year").map((p) => p.period)).toEqual(["2024", "2025", "2026"]);
    expect(trend([], "week")).toEqual([]);
  });

  it("period totals add up to the overall totals, and too many periods is refused", async () => {
    await seed({ inc: "I1", at: T0, answer: "SATISFIED" });
    await seed({ inc: "I2", at: T0 + 20 * 86400_000, answer: "UNSATISFIED" });
    await seed({ inc: "I3", at: T0 + 40 * 86400_000 });
    const a = await getAnalytics(admin, f({ grain: "week" }));
    expect(a.trend.reduce((s, p) => s + p.surveys, 0)).toBe(a.kpis.surveys);
    expect(a.trend.reduce((s, p) => s + p.responses, 0)).toBe(a.kpis.responses);
    expect(a.trend.at(0)).toMatchObject({ satisfactionPct: 100 });
    await seed({ inc: "I4", at: Date.UTC(2024, 0, 1) });
    await expect(getAnalytics(admin, f({ grain: "day" }))).rejects.toMatchObject({ status: 400 });
    await expect(getAnalytics(admin, f({ grain: "month" }))).resolves.toBeTruthy();
  });
});

describe("Excel export", () => {
  const load = async (buf: Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as never); return wb; };

  it("neutralises text that Excel would run as a formula", () => {
    for (const bad of ["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\tx", "\rx"]) expect(safeCell(bad)).toBe(`'${bad}`);
    expect(safeCell("VPN")).toBe("VPN");
    expect(safeCell(5)).toBe(5);
    expect(safeCell(null)).toBeNull();
  });

  it("has the expected sheets, no requester email or comments, and safe cells", async () => {
    await seed({ inc: "X1", at: T0, answer: "UNSATISFIED", service: "=HYPERLINK(\"http://evil\")", agent: "@agent" });
    await db.surveyResponse.updateMany({ data: { comments: "private words" } });
    await seed({ inc: "X2", at: T0, answer: "SATISFIED" });
    const wb = await load(await buildWorkbook(admin, f()));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Trend", "Groups", "Agents", "Services", "Categories", "Heatmap", "Surveys"]);
    const all: string[] = [];
    wb.eachSheet((ws) => ws.eachRow((r) => r.eachCell((c) => all.push(String(c.value)))));
    const text = all.join("\n");
    expect(text).not.toContain("r@example.test");
    expect(text).not.toContain("private words");
    expect(text).not.toMatch(/requester|comment/i);
    expect(all).toContain("'=HYPERLINK(\"http://evil\")");
    expect(all).toContain("'@agent");
    expect(all.some((v) => v.startsWith("="))).toBe(false);
    expect(wb.getWorksheet("Surveys")!.rowCount).toBe(3); // header and two surveys
  });

  it("exports only what the viewer may see, with their filters", async () => {
    await seed({ inc: "Y1", at: T0, answer: "SATISFIED", group: "Network" });
    await seed({ inc: "Y2", at: T0, answer: "SATISFIED", group: "Service Desk" });
    const grp: V = { role: "SUPPORT_GROUP", supportGroup: "Network", agentName: null };
    const rows = (await load(await buildWorkbook(grp, f()))).getWorksheet("Surveys")!;
    expect(rows.rowCount).toBe(2);
    expect(String(rows.getRow(2).getCell(1).value)).toBe("Y1");
    expect((await load(await buildWorkbook(admin, f({ group: "Service Desk" })))).getWorksheet("Surveys")!.rowCount).toBe(2);
  });
});

describe("loadRows", () => {
  it("returns newest first and does not flag truncation for a small set", async () => {
    await seed({ inc: "Z1", at: T0 }); await seed({ inc: "Z2", at: T0 + H });
    const r = await loadRows(admin, f() as Filters);
    expect(r.rows.map((x) => x.incidentId)).toEqual(["Z2", "Z1"]);
    expect(r.truncated).toBe(false);
  });
});
