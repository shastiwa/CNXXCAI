"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@prisma/client";
import { ALL_ROLES, ROLE_LABELS } from "@/lib/roles";

interface Row { id: string; email: string; role: Role; supportGroup: string | null; agentName: string | null; active: boolean }

function UserRow({ user, isSelf }: { user: Row; isSelf: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(user);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const changed = JSON.stringify(v) !== JSON.stringify(user);

  async function save() {
    if (!window.confirm(`Change access for ${user.email}? It applies on their next request.`)) return;
    setBusy(true);
    setMsg("");
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: v.role, supportGroup: v.supportGroup, agentName: v.agentName, active: v.active }),
    });
    setBusy(false);
    if (res.ok) { setMsg("Saved"); router.refresh(); }
    else setMsg((await res.json().catch(() => ({}))).error ?? "Could not save");
  }

  return (
    <tr>
      <td>{user.email}{isSelf && <span className="muted"> (you)</span>}</td>
      <td>
        <select aria-label={`Role for ${user.email}`} value={v.role} disabled={isSelf}
          onChange={(e) => setV({ ...v, role: e.target.value as Role })}>
          {ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </td>
      <td>
        {v.role === "SUPPORT_GROUP" && (
          <input aria-label={`Support group for ${user.email}`} placeholder="Support group" value={v.supportGroup ?? ""}
            onChange={(e) => setV({ ...v, supportGroup: e.target.value })} />
        )}
        {v.role === "SUPPORT_AGENT" && (
          <input aria-label={`Agent name for ${user.email}`} placeholder="Agent name as in Helix" value={v.agentName ?? ""}
            onChange={(e) => setV({ ...v, agentName: e.target.value })} />
        )}
        {v.role !== "SUPPORT_GROUP" && v.role !== "SUPPORT_AGENT" && "-"}
      </td>
      <td>
        <input type="checkbox" style={{ width: "auto" }} aria-label={`Active: ${user.email}`} checked={v.active} disabled={isSelf}
          onChange={(e) => setV({ ...v, active: e.target.checked })} />
      </td>
      <td>
        <button className="secondary" disabled={!changed || busy || isSelf} onClick={save}>Save</button>
        {msg && <span role="status" className={msg === "Saved" ? "muted" : "err"}> {msg}</span>}
      </td>
    </tr>
  );
}

export default function UsersTable({ users, selfId }: { users: Row[]; selfId: string }) {
  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <table>
        <thead><tr><th>Email</th><th>Role</th><th>Group / agent</th><th>Active</th><th /></tr></thead>
        <tbody>{users.map((u) => <UserRow key={u.id} user={u} isSelf={u.id === selfId} />)}</tbody>
      </table>
    </div>
  );
}
