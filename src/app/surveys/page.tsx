import Link from "next/link";
import { redirect } from "next/navigation";
import type { InviteStatus } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { ROLES_MANAGE_SURVEYS } from "@/lib/roles";
import { ALL_STATUSES, listSurveys } from "@/services/tracking";
import Nav from "../Nav";
import SurveyActions from "./SurveyActions";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null) => (d ? d.toISOString().replace("T", " ").slice(0, 16) : "-");

export default async function Surveys({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await getSession();
  if (!user) redirect("/login?next=/surveys");
  const { status } = await searchParams;
  const filter = ALL_STATUSES.includes(status as InviteStatus) ? (status as InviteStatus) : undefined;
  const rows = await listSurveys(user, { status: filter });
  const canManage = ROLES_MANAGE_SURVEYS.includes(user.role);

  return (
    <>
      <Nav email={user.email} role={user.role} />
      <main>
        <h1>Surveys</h1>
        <p className="muted">
          Status of every survey. Filter:{" "}
          <Link href="/surveys">All</Link>
          {ALL_STATUSES.map((s) => <span key={s}> | <Link href={`/surveys?status=${s}`}>{s}</Link></span>)}
        </p>
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr><th>Incident</th><th>Group</th><th>Service</th><th>Status</th><th>Created</th><th>Expires</th><th>Reminders</th><th>History</th>{canManage && <th />}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.incidentId}{r.reopened && <div className="muted">reopened</div>}</td>
                  <td>{r.supportGroup}</td>
                  <td>{r.serviceName ?? "-"}</td>
                  <td>{r.status}{r.replaced && <div className="muted">replaced by a newer survey</div>}</td>
                  <td>{fmt(r.createdAt)}</td>
                  <td>{fmt(r.expiresAt)}</td>
                  <td>{r.reminderCount}</td>
                  <td>
                    <details>
                      <summary>{r.history.length} events</summary>
                      <ul style={{ margin: "6px 0", paddingLeft: 18 }}>
                        {r.history.map((h) => (
                          <li key={h.id}>
                            {fmt(h.at)}: {h.from ? `${h.from} to ${h.to}` : h.to}{h.note ? `, ${h.note}` : ""} <span className="muted">({h.by})</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </td>
                  {canManage && <td><SurveyActions id={r.id} status={r.status} replaced={r.replaced} /></td>}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={9} className="muted">No surveys.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
