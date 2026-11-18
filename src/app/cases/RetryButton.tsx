"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RetryButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function retry() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/cases/${id}/retry`, { method: "POST" });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Retry failed");
    setBusy(false);
    router.refresh();
  }

  return (
    <>
      <button className="secondary" onClick={retry} disabled={busy}>{busy ? "Retrying..." : "Retry"}</button>
      {error && <div className="err">{error}</div>}
    </>
  );
}
