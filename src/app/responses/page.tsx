import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canSeeRequesterEmail, listResponses } from "@/services/responses";
import Nav from "../Nav";

export const dynamic = "force-dynamic";

const FILTERS = [
  { label: "All", value: undefined, href: "/responses" },
  { label: "Satisfied", value: "SATISFIED", href: "/responses?satisfaction=SATISFIED" },
  { label: "Unsatisfied", value: "UNSATISFIED", href: "/responses?satisfaction=UNSATISFIED" },
] as const;

export default async function Responses({ searchParams }: { searchParams: Promise<{ satisfaction?: string }> }) {
  const user = await getSession();
  if (!user) redirect("/login?next=/responses");
  const { satisfaction: s } = await searchParams;
  const satisfaction = s === "SATISFIED" || s === "UNSATISFIED" ? s : undefined;
  const rows = await listResponses(user, { satisfaction });
  const showEmail = canSeeRequesterEmail(user);

  return (
    <>
      <Nav email={user.email} role={user.role} />
      <main>
        <h1>Survey responses</h1>
        {user.role === "SUPPORT_GROUP" && <p className="muted">Showing group: {user.supportGroup ?? "none"}</p>}
        {user.role === "SUPPORT_AGENT" && <p className="muted">Showing surveys for agent: {user.agentName ?? "none (ask an administrator to set your agent name)"}</p>}
        <p className="muted">Responses contain free-text comments. Treat them as personal data.</p>
        <div className="row" style={{ marginBottom: 12 }}>
          {FILTERS.map((f) => (
            <Link key={f.label} className={`btn ${f.value === satisfaction ? "" : "secondary"}`} href={f.href}>
              {f.label}
            </Link>
          ))}
        </div>
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>When</th><th>Incident</th><th>Group</th>{showEmail && <th>Requester</th>}
                <th>Answer</th><th>Min lost</th><th>Reason</th><th>Call back</th><th>Comments</th><th>Files</th><th>Case</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.createdAt.toISOString().replace("T", " ").slice(0, 16)}</td>
                  <td>{r.incidentId}</td>
                  <td>{r.supportGroup}</td>
                  {showEmail && <td>{r.requesterEmail}</td>}
                  <td className={r.satisfaction === "SATISFIED" ? "" : "err"}>{r.satisfaction}</td>
                  <td>{r.productivityLossMin ?? "-"}</td>
                  <td>{r.dissatisfactionReason ?? "-"}</td>
                  <td>{r.callbackPreference}</td>
                  <td style={{ minWidth: 200, whiteSpace: "pre-wrap" }}>{r.comments ?? "-"}</td>
                  <td>
                    {r.attachments.length > 0
                      ? r.attachments.map((a) => (
                          <div key={a.id}><a href={`/api/attachments/${a.id}`}>{a.fileName}</a></div>
                        ))
                      : r.attachmentCount > 0 ? `${r.attachmentCount} (hidden)` : "-"}
                  </td>
                  <td>{r.caseNumber ?? r.caseStatus ?? "-"}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={showEmail ? 11 : 10} className="muted">No responses yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
