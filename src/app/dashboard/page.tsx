import Link from "next/link";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { getSession, HttpError } from "@/lib/auth";
import { ROLES_EXPORT, SCOPE_BY_ROLE } from "@/lib/roles";
import { getAnalytics, getFilterOptions, GRAINS, parseFilters, type Filters } from "@/services/analytics";
import Nav from "../Nav";
import { BreakdownTable, Chart, Heatmap } from "./Charts";

export const dynamic = "force-dynamic";

const show = (v: number | null, unit = "") => (v === null ? "-" : `${v}${unit}`);

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getSession();
  if (!user) redirect("/login?next=/dashboard");

  let filters: Filters;
  let problem = "";
  try {
    filters = parseFilters(await searchParams);
  } catch (e) {
    if (!(e instanceof ZodError)) throw e;
    problem = "Those filters were not valid, so they were ignored.";
    filters = parseFilters({});
  }
  let data: Awaited<ReturnType<typeof getAnalytics>>;
  try {
    data = await getAnalytics(user, filters);
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 400) throw e;
    problem = `${e.message} Showing the default period instead.`;
    filters = { ...filters, grain: "month" };
    data = await getAnalytics(user, filters);
  }
  const options = await getFilterOptions(user);
  const k = data.kpis;

  const exportQuery = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();
  const stats: [string, string][] = [
    ["Surveys", String(k.surveys)],
    ["Responses", String(k.responses)],
    ["Response rate", show(k.responseRatePct, "%")],
    ["Satisfied", show(k.satisfactionPct, "%")],
    ["Unsatisfied", show(k.dissatisfactionPct, "%")],
    ["Still open", String(k.pending)],
    ["Expired", String(k.expired)],
    ["Cancelled", String(k.cancelled)],
    ["Average time to answer", show(k.avgResponseHours, " h")],
    ["Cases not yet in BWF", String(k.casesWaiting)],
    ["Minutes lost", String(k.minutesLost)],
  ];
  const select = (name: keyof Filters, label: string, values: string[]) => values.length === 0 ? null : (
    <div>
      <label htmlFor={`f-${name}`}>{label}</label>
      <select id={`f-${name}`} name={name} defaultValue={filters[name] ?? ""}>
        <option value="">All</option>
        {values.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </div>
  );

  return (
    <>
      <Nav email={user.email} role={user.role} />
      <main style={{ maxWidth: 1100 }}>
        <h1>Dashboard</h1>
        {user.role === "SUPPORT_GROUP" && <p className="muted">Showing group: {user.supportGroup ?? "none"}</p>}
        {user.role === "SUPPORT_AGENT" && <p className="muted">Showing surveys for agent: {user.agentName ?? "none (ask an administrator to set your agent name)"}</p>}
        {problem && <p role="alert" className="err">{problem}</p>}

        <form className="card" method="get" action="/dashboard">
          <div className="filters">
            <div><label htmlFor="f-from">Survey date from</label><input id="f-from" type="date" name="from" defaultValue={filters.from ?? ""} /></div>
            <div><label htmlFor="f-to">to</label><input id="f-to" type="date" name="to" defaultValue={filters.to ?? ""} /></div>
            {SCOPE_BY_ROLE[user.role] === "all" && select("group", "Support group", options.groups)}
            {select("service", "Service", options.services)}
            {select("category", "Category", options.categories)}
            {select("priority", "Priority", options.priorities)}
            {select("agent", "Agent", options.agents)}
            <div>
              <label htmlFor="f-grain">Trend period</label>
              <select id="f-grain" name="grain" defaultValue={filters.grain}>
                {GRAINS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>
          <p className="row" style={{ marginBottom: 0 }}>
            <button>Apply</button>
            <Link className="btn secondary" href="/dashboard">Reset</Link>
            {ROLES_EXPORT.includes(user.role) && <a className="btn secondary" href={`/api/dashboard/export?${exportQuery}`}>Download Excel</a>}
          </p>
          <p className="muted" style={{ marginBottom: 0 }}>
            Dates are the day the survey was created (UTC). An incident that was reopened counts once, by its latest survey.
            The Excel file has no requester email and no comments.
          </p>
        </form>

        {data.truncated && <p role="alert" className="err">Too many surveys to read at once. The numbers cover the newest ones only; narrow the date range.</p>}

        <div className="grid">
          {stats.map(([label, value]) => (
            <div className="card stat" key={label}>
              <span className="muted">{label}</span>
              <b>{value}</b>
            </div>
          ))}
        </div>

        <h2>Trends</h2>
        <div className="grid2">
          <div className="card">
            <Chart title={`Surveys answered per ${filters.grain}`} kind="bar"
              points={data.trend.map((p) => ({ label: p.period, value: p.responses, tip: `${p.period}: ${p.responses} answered of ${p.surveys} surveys` }))} />
          </div>
          <div className="card">
            <Chart title={`Satisfied answers per ${filters.grain} (%)`} kind="line" fixedMax={100} unit="%"
              points={data.trend.map((p) => ({ label: p.period, value: p.satisfactionPct, tip: p.satisfactionPct === null ? `${p.period}: no answers` : `${p.period}: ${p.satisfactionPct}% satisfied (${p.satisfied} of ${p.responses})` }))} />
          </div>
        </div>

        <h2>Where the answers come from</h2>
        <p className="muted">A satisfaction score shows only when there are at least {data.minResponses} answers, so a few answers cannot rank a person or team.</p>
        <div className="grid2">
          {SCOPE_BY_ROLE[user.role] === "all" && <BreakdownTable title="By support group" rows={data.byGroup} min={data.minResponses} />}
          <BreakdownTable title="By service" rows={data.byService} min={data.minResponses} />
          <BreakdownTable title="By category" rows={data.byCategory} min={data.minResponses} />
          {SCOPE_BY_ROLE[user.role] !== "agent" && <BreakdownTable title="By agent" rows={data.byAgent} min={data.minResponses} />}
        </div>

        <h2>Heatmap</h2>
        <Heatmap {...data.heatmap} min={data.minResponses} />
      </main>
    </>
  );
}
