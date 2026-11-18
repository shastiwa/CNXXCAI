"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Role } from "@prisma/client";
import { ROLE_LABELS, ROLES_ADMIN, ROLES_WORK_CASES } from "@/lib/roles";

export default function Nav({ email, role }: { email: string; role: Role }) {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }
  // Menu links only follow the server's rules. Each page and API route checks the role again.
  const canCases = ROLES_WORK_CASES.includes(role);
  return (
    <nav>
      <strong>SolvNow XC AI</strong>
      <Link href="/dashboard">Dashboard</Link>
      <Link href="/responses">Responses</Link>
      {canCases && <Link href="/cases">Cases</Link>}
      {ROLES_ADMIN.includes(role) && <Link href="/admin">Admin</Link>}
      <span className="spacer" />
      <span className="muted">{email} ({ROLE_LABELS[role]})</span>
      <button className="secondary" onClick={logout}>Sign out</button>
    </nav>
  );
}
