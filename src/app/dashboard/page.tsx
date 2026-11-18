import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getDashboardMetrics } from "@/services/metrics";
import Nav from "../Nav";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const user = await getSession();
  if (!user) redirect("/login?next=/dashboard");
  const m = await getDashboardMetrics(user);
  const stats: [string, string | number][] = [
    ["Invites sent", m.invites],
    ["Responses", m.responses],
    ["Response rate", `${m.responseRatePct}%`],
    ["Satisfied", `${m.satisfactionPct}%`],
    ["Unsatisfied", m.unsatisfied],
    ["Minutes lost", m.productivityLossMin],
    ["Cases created", m.cases.created],
    ["Cases failed", m.cases.failed],
    ["Cases pending", m.cases.pending],
  ];
  return (
    <>
      <Nav email={user.email} role={user.role} />
      <main>
        <h1>Dashboard</h1>
        {user.role === "SUPPORT_GROUP" && <p className="muted">Showing group: {user.supportGroup ?? "none"}</p>}
        {user.role === "SUPPORT_AGENT" && <p className="muted">Showing surveys for agent: {user.agentName ?? "none (ask an administrator to set your agent name)"}</p>}
        <div className="grid">
          {stats.map(([label, value]) => (
            <div className="card stat" key={label}>
              <span className="muted">{label}</span>
              <b>{value}</b>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
