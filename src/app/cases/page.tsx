import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ROLES_WORK_CASES } from "@/lib/roles";
import Nav from "../Nav";
import RetryButton from "./RetryButton";

export const dynamic = "force-dynamic";

export default async function Cases() {
  const user = await getSession();
  if (!user) redirect("/login?next=/cases");
  if (!ROLES_WORK_CASES.includes(user.role)) notFound();

  // ADR-005: org-wide by design, not group-scoped.
  const cases = await db.recoveryCase.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { response: { include: { invite: true } } },
  });

  return (
    <>
      <Nav email={user.email} role={user.role} />
      <main>
        <h1>Recovery cases</h1>
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr><th>Incident</th><th>Group</th><th>Reason</th><th>Status</th><th>BWF case</th><th>Tries</th><th /></tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id}>
                  <td>{c.response.invite.incidentId}</td>
                  <td>{c.response.invite.supportGroup}</td>
                  <td>{c.response.dissatisfactionReason ?? "-"}</td>
                  <td>
                    {c.status}
                    {c.lastError && <div className="err">{c.lastError}</div>}
                  </td>
                  <td>{c.bwfCaseNumber ?? "-"}</td>
                  <td>{c.attempts}</td>
                  <td>{c.status !== "CREATED" && <RetryButton id={c.id} />}</td>
                </tr>
              ))}
              {cases.length === 0 && <tr><td colSpan={7} className="muted">No cases yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
