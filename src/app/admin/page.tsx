import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import Nav from "../Nav";

export const dynamic = "force-dynamic";

export default async function Admin() {
  const user = await getSession();
  if (!user) redirect("/login?next=/admin");
  if (user.role !== "ADMIN") notFound();

  const [users, logs] = await Promise.all([
    db.user.findMany({ orderBy: { email: "asc" }, select: { id: true, email: true, role: true, supportGroup: true, active: true } }),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { actor: { select: { email: true } } } }),
  ]);

  return (
    <>
      <Nav email={user.email} role={user.role} />
      <main>
        <h1>Admin</h1>
        <h2>Users</h2>
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Email</th><th>Role</th><th>Group</th><th>Active</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}><td>{u.email}</td><td>{u.role}</td><td>{u.supportGroup ?? "-"}</td><td>{u.active ? "yes" : "no"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <h2>Recent audit log</h2>
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>{l.createdAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                  <td>{l.actor?.email ?? "-"}</td><td>{l.action}</td><td>{l.target ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
