import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { SCOPE_BY_ROLE } from "@/lib/roles";
import { buildScopeFilters, type Viewer } from "./metrics";
import { getSettings } from "./settings";

export const UNKNOWN = "(unknown)";
export const GRAINS = ["day", "week", "month", "quarter", "year"] as const;
export type Grain = (typeof GRAINS)[number];
/** Most surveys one request reads. Past this the page says the numbers cover the newest ones only. */
export const ROW_CAP = 20000;
const MAX_BUCKETS = 400;
const DAY_MS = 86400_000;

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T00:00:00Z`); // an impossible date is "Invalid Date", and toISOString() would throw on it
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "not a real date");
const text = z.string().max(200);
export const filterSchema = z.object({
  from: dateText.optional(),
  to: dateText.optional(),
  group: text.optional(),
  service: text.optional(),
  category: text.optional(),
  priority: text.optional(),
  agent: text.optional(),
  grain: z.enum(GRAINS).default("week"),
}).strict().refine((f) => !f.from || !f.to || f.from <= f.to, { message: "from is after to" });
export type Filters = z.infer<typeof filterSchema>;

/** Query string or page search params in, validated filters out. Unknown keys are refused. Throws a ZodError. */
export function parseFilters(input: URLSearchParams | Record<string, string | string[] | undefined>): Filters {
  const entries: [string, string | undefined][] = input instanceof URLSearchParams
    ? [...input.entries()]
    : Object.entries(input).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]);
  const raw: Record<string, string> = {};
  for (const [k, v] of entries) if (v) raw[k] = v;
  return filterSchema.parse(raw);
}

type TextField = "serviceName" | "category" | "priority" | "assignedAgent";
const matchText = (field: TextField, v: string): Prisma.SurveyInviteWhereInput =>
  v === UNKNOWN ? { OR: [{ [field]: null }, { [field]: "" }] } : { [field]: v };

function filterWhere(f: Filters): Prisma.SurveyInviteWhereInput[] {
  const w: Prisma.SurveyInviteWhereInput[] = [];
  if (f.from) w.push({ createdAt: { gte: new Date(`${f.from}T00:00:00Z`) } });
  if (f.to) w.push({ createdAt: { lt: new Date(new Date(`${f.to}T00:00:00Z`).getTime() + DAY_MS) } }); // the whole "to" day
  if (f.group) w.push({ supportGroup: f.group });
  if (f.service) w.push(matchText("serviceName", f.service));
  if (f.category) w.push(matchText("category", f.category));
  if (f.priority) w.push(matchText("priority", f.priority));
  if (f.agent) w.push(matchText("assignedAgent", f.agent));
  return w;
}

const rowSelect = {
  id: true, incidentId: true, createdAt: true, sentAt: true, expiresAt: true, status: true,
  supportGroup: true, serviceName: true, category: true, priority: true, assignedAgent: true,
  response: { select: { satisfaction: true, createdAt: true, dissatisfactionReason: true, productivityLossMin: true, recoveryCase: { select: { status: true } } } },
} satisfies Prisma.SurveyInviteSelect;
export type Row = Prisma.SurveyInviteGetPayload<{ select: typeof rowSelect }>;

/**
 * The surveys this viewer may see, after the filters. A reopened survey replaces the old one, so each
 * incident counts once. Newest first; if there are more than ROW_CAP the oldest are left out and `truncated` is set.
 */
export async function loadRows(user: Viewer, f: Filters) {
  const scope = buildScopeFilters(user);
  const rows = await db.surveyInvite.findMany({
    where: { AND: [scope.invite, { replacedById: null }, ...filterWhere(f)] },
    orderBy: { createdAt: "desc" },
    take: ROW_CAP + 1,
    select: rowSelect,
  });
  return { rows: rows.slice(0, ROW_CAP), truncated: rows.length > ROW_CAP };
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
const label = (v: string | null) => (v && v.trim() ? v : UNKNOWN);

export function summarize(rows: Row[], now = new Date()) {
  let responses = 0, satisfied = 0, pending = 0, expired = 0, cancelled = 0, waiting = 0, waitMs = 0, lost = 0;
  for (const r of rows) {
    if (r.response) {
      responses++;
      lost += r.response.productivityLossMin ?? 0;
      if (r.response.satisfaction === "SATISFIED") satisfied++;
      waitMs += Math.max(0, r.response.createdAt.getTime() - (r.sentAt ?? r.createdAt).getTime());
      if (r.response.recoveryCase && r.response.recoveryCase.status !== "CREATED") waiting++;
    } else if (r.status === "CANCELLED") cancelled++;
    // Past its expiry counts as expired even if the job has not marked it yet.
    else if (r.status === "EXPIRED" || r.expiresAt < now) expired++;
    else pending++;
  }
  const unsatisfied = responses - satisfied;
  return {
    surveys: rows.length, responses, satisfied, unsatisfied,
    responseRatePct: pct(responses, rows.length),
    satisfactionPct: pct(satisfied, responses),
    dissatisfactionPct: pct(unsatisfied, responses),
    pending, expired, cancelled,
    avgResponseHours: responses ? Math.round((waitMs / responses / 3600_000) * 10) / 10 : null,
    casesWaiting: waiting,
    minutesLost: lost,
  };
}
export type Kpis = ReturnType<typeof summarize>;

export interface BreakdownRow {
  name: string; surveys: number; responses: number; satisfied: number; unsatisfied: number;
  /** null when there are fewer answers than the minimum: too few to rank anyone on. */
  satisfactionPct: number | null; enough: boolean;
}

export function breakdown(rows: Row[], key: (r: Row) => string, min: number): BreakdownRow[] {
  const m = new Map<string, { surveys: number; responses: number; satisfied: number }>();
  for (const r of rows) {
    const k = key(r);
    const e = m.get(k) ?? { surveys: 0, responses: 0, satisfied: 0 };
    e.surveys++;
    if (r.response) { e.responses++; if (r.response.satisfaction === "SATISFIED") e.satisfied++; }
    m.set(k, e);
  }
  return [...m.entries()]
    .map(([name, e]) => {
      const enough = e.responses >= min;
      return { name, ...e, unsatisfied: e.responses - e.satisfied, satisfactionPct: enough ? pct(e.satisfied, e.responses) : null, enough };
    })
    .sort((a, b) => b.responses - a.responses || b.surveys - a.surveys || a.name.localeCompare(b.name));
}

export interface HeatCell { responses: number; unsatisfied: number; dissatisfactionPct: number | null; enough: boolean }

/** Support group (rows) by service (columns), each limited to the busiest 10. A cell shows no percentage below the minimum. */
export function heatmap(rows: Row[], min: number) {
  const top = (key: (r: Row) => string) => {
    const c = new Map<string, number>();
    for (const r of rows) c.set(key(r), (c.get(key(r)) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([k]) => k);
  };
  const groups = top((r) => r.supportGroup);
  const services = top((r) => label(r.serviceName));
  const cells = groups.map((g) => services.map((s): HeatCell => {
    let responses = 0, unsatisfied = 0;
    for (const r of rows) {
      if (r.supportGroup !== g || label(r.serviceName) !== s || !r.response) continue;
      responses++;
      if (r.response.satisfaction === "UNSATISFIED") unsatisfied++;
    }
    const enough = responses >= min;
    return { responses, unsatisfied, dissatisfactionPct: enough ? pct(unsatisfied, responses) : null, enough };
  }));
  return { groups, services, cells };
}

// Periods are UTC. Weeks start on Monday.
function floorTo(d: Date, g: Grain): Date {
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  switch (g) {
    case "day": return new Date(Date.UTC(y, m, d.getUTCDate()));
    case "week": { const day = new Date(Date.UTC(y, m, d.getUTCDate())); return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS); }
    case "month": return new Date(Date.UTC(y, m, 1));
    case "quarter": return new Date(Date.UTC(y, m - (m % 3), 1));
    case "year": return new Date(Date.UTC(y, 0, 1));
  }
}
function step(d: Date, g: Grain): Date {
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  switch (g) {
    case "day": return new Date(d.getTime() + DAY_MS);
    case "week": return new Date(d.getTime() + 7 * DAY_MS);
    case "month": return new Date(Date.UTC(y, m + 1, 1));
    case "quarter": return new Date(Date.UTC(y, m + 3, 1));
    case "year": return new Date(Date.UTC(y + 1, 0, 1));
  }
}
function periodName(d: Date, g: Grain) {
  const iso = d.toISOString();
  if (g === "day" || g === "week") return iso.slice(0, 10);
  if (g === "month") return iso.slice(0, 7);
  if (g === "quarter") return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  return String(d.getUTCFullYear());
}

export interface TrendPoint { period: string; surveys: number; responses: number; satisfied: number; satisfactionPct: number | null }

/** Surveys by the period they were created in. Empty periods in between are kept so the chart does not hide gaps. */
export function trend(rows: Row[], grain: Grain): TrendPoint[] {
  if (rows.length === 0) return [];
  const times = rows.map((r) => r.createdAt.getTime());
  const first = floorTo(new Date(Math.min(...times)), grain);
  const last = floorTo(new Date(Math.max(...times)), grain);
  const buckets = new Map<string, TrendPoint>();
  let n = 0;
  for (let d = first; d <= last; d = step(d, grain)) {
    if (++n > MAX_BUCKETS) throw new HttpError(400, "Too many periods for this range. Choose a longer period or a shorter date range.");
    buckets.set(periodName(d, grain), { period: periodName(d, grain), surveys: 0, responses: 0, satisfied: 0, satisfactionPct: null });
  }
  for (const r of rows) {
    const b = buckets.get(periodName(floorTo(r.createdAt, grain), grain))!;
    b.surveys++;
    if (r.response) { b.responses++; if (r.response.satisfaction === "SATISFIED") b.satisfied++; }
  }
  return [...buckets.values()].map((b) => ({ ...b, satisfactionPct: pct(b.satisfied, b.responses) }));
}

export async function getAnalytics(user: Viewer, f: Filters) {
  const { rows, truncated } = await loadRows(user, f);
  const min = (await getSettings()).minResponses;
  return {
    filters: f,
    minResponses: min,
    truncated,
    kpis: summarize(rows),
    trend: trend(rows, f.grain),
    byGroup: breakdown(rows, (r) => r.supportGroup, min),
    byAgent: breakdown(rows, (r) => label(r.assignedAgent), min),
    byService: breakdown(rows, (r) => label(r.serviceName), min),
    byCategory: breakdown(rows, (r) => label(r.category), min),
    heatmap: heatmap(rows, min),
  };
}

/** Values for the filter drop-downs, from the surveys this viewer may see (before any filter is applied). */
export async function getFilterOptions(user: Viewer) {
  const where: Prisma.SurveyInviteWhereInput = { AND: [buildScopeFilters(user).invite, { replacedById: null }] };
  const distinct = async (field: "supportGroup" | TextField) => {
    const vals = await db.surveyInvite.findMany({ where, distinct: [field], select: { [field]: true }, take: 300 });
    const names = vals.map((v) => (v as unknown as Record<string, string | null>)[field]);
    const set = new Set(names.map((n) => label(n)));
    return [...set].sort((a, b) => (a === UNKNOWN ? 1 : b === UNKNOWN ? -1 : a.localeCompare(b)));
  };
  const [groups, services, categories, priorities, agents] = await Promise.all([
    distinct("supportGroup"), distinct("serviceName"), distinct("category"), distinct("priority"),
    // An agent only ever sees their own surveys, so a list of agents would be pointless.
    SCOPE_BY_ROLE[user.role] === "agent" ? Promise.resolve([] as string[]) : distinct("assignedAgent"),
  ]);
  return { groups, services, categories, priorities, agents };
}
