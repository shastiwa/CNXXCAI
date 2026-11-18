import ExcelJS from "exceljs";
import { breakdown, heatmap, loadRows, summarize, trend, type BreakdownRow, type Filters, type Row } from "./analytics";
import type { Viewer } from "./metrics";
import { getSettings } from "./settings";

/**
 * Text that starts with = + - @ (or a tab or return) can run as a formula when the file is opened in Excel.
 * Helix text (service names, categories, agent names) is not ours, so every text cell is made safe.
 */
export function safeCell(v: string | number | null | undefined): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : null);

function addTable(wb: ExcelJS.Workbook, name: string, header: string[], rows: (string | number | null)[][]) {
  const ws = wb.addWorksheet(name);
  // Headers too: the heatmap's column headers are service names that come from Helix.
  ws.addRow(header.map((h) => safeCell(h))).font = { bold: true };
  for (const r of rows) ws.addRow(r.map((c) => (typeof c === "string" ? safeCell(c) : c)));
  ws.columns.forEach((c, i) => { c.width = Math.max(12, Math.min(40, (header[i]?.length ?? 10) + 4)); });
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

const breakdownRows = (b: BreakdownRow[]) =>
  b.map((r) => [r.name, r.surveys, r.responses, r.satisfied, r.unsatisfied, r.satisfactionPct, r.enough ? "yes" : "too few answers"]);
const BREAKDOWN_HEAD = (first: string) => [first, "Surveys", "Responses", "Satisfied", "Unsatisfied", "Satisfaction %", "Enough answers to score"];

/**
 * An .xlsx of what this viewer sees, with the filters applied. Never contains requester email or comments:
 * an export leaves the system, so it carries counts and answers only. Rows are limited to what the viewer's role may see.
 */
export async function buildWorkbook(user: Viewer, f: Filters): Promise<Buffer> {
  const { rows, truncated } = await loadRows(user, f);
  const min = (await getSettings()).minResponses;
  const k = summarize(rows);

  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  addTable(wb, "Summary", ["Measure", "Value"], [
    ["Survey date from", f.from ?? "any"], ["Survey date to", f.to ?? "any"],
    ["Group", f.group ?? "all"], ["Service", f.service ?? "all"], ["Category", f.category ?? "all"],
    ["Priority", f.priority ?? "all"], ["Agent", f.agent ?? "all"],
    ["Minimum answers to show a score", min],
    ["Only the newest surveys are included (too many to export)", truncated ? "yes" : "no"],
    ["Surveys", k.surveys], ["Responses", k.responses], ["Response rate %", k.responseRatePct],
    ["Satisfied", k.satisfied], ["Unsatisfied", k.unsatisfied],
    ["Satisfaction %", k.satisfactionPct], ["Dissatisfaction %", k.dissatisfactionPct],
    ["Still open", k.pending], ["Expired", k.expired], ["Cancelled", k.cancelled],
    ["Average hours to answer", k.avgResponseHours], ["Cases not yet in BWF", k.casesWaiting],
  ]);
  addTable(wb, "Trend", ["Period (UTC)", "Surveys", "Responses", "Satisfied", "Satisfaction %"],
    trend(rows, f.grain).map((p) => [p.period, p.surveys, p.responses, p.satisfied, p.satisfactionPct]));
  const label = (v: string | null) => (v && v.trim() ? v : "(unknown)");
  addTable(wb, "Groups", BREAKDOWN_HEAD("Support group"), breakdownRows(breakdown(rows, (r) => r.supportGroup, min)));
  addTable(wb, "Agents", BREAKDOWN_HEAD("Agent"), breakdownRows(breakdown(rows, (r) => label(r.assignedAgent), min)));
  addTable(wb, "Services", BREAKDOWN_HEAD("Service"), breakdownRows(breakdown(rows, (r) => label(r.serviceName), min)));
  addTable(wb, "Categories", BREAKDOWN_HEAD("Category"), breakdownRows(breakdown(rows, (r) => label(r.category), min)));

  const h = heatmap(rows, min);
  addTable(wb, "Heatmap", ["Dissatisfaction % (group down, service across)", ...h.services],
    h.groups.map((g, i) => [g, ...h.cells[i].map((c) => (c.enough ? c.dissatisfactionPct : null))]));

  addTable(wb, "Surveys",
    ["Incident", "Support group", "Service", "Category", "Priority", "Agent", "Status", "Created (UTC)", "Answered (UTC)", "Hours to answer", "Answer", "Reason"],
    rows.map((r: Row) => [
      r.incidentId, r.supportGroup, label(r.serviceName), label(r.category), label(r.priority), label(r.assignedAgent),
      r.status, iso(r.createdAt), iso(r.response?.createdAt ?? null),
      r.response ? Math.round((Math.max(0, r.response.createdAt.getTime() - (r.sentAt ?? r.createdAt).getTime()) / 3600_000) * 10) / 10 : null,
      r.response?.satisfaction ?? null, r.response?.dissatisfactionReason ?? null,
    ]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
