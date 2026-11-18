"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function Nav({ email, role }: { email: string; role: string }) {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }
  const canCases = role === "ADMIN" || role === "EXPERIENCE_TEAM";
  return (
    <nav>
      <strong>SolvNow XC AI</strong>
      <Link href="/dashboard">Dashboard</Link>
      <Link href="/responses">Responses</Link>
      {canCases && <Link href="/cases">Cases</Link>}
      {role === "ADMIN" && <Link href="/admin">Admin</Link>}
      <span className="spacer" />
      <span className="muted">{email} ({role})</span>
      <button className="secondary" onClick={logout}>Sign out</button>
    </nav>
  );
}
