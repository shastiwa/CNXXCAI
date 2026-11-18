"use client";
import { useState } from "react";

export default function JobsPanel() {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/jobs/run", { method: "POST" });
    setBusy(false);
    const b = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(b.error ?? "Failed."); return; }
    const r = b.reminders;
    setMsg(`Expired ${b.expired} survey(s). Reminders: ${r.due} due, ${r.sent} sent, ${r.failed} failed.${r.note ? ` ${r.note}` : ""}`);
  }

  return (
    <div className="card">
      <p className="muted">Expires overdue surveys and sends reminders. Safe to run again at any time. A scheduler can call it too (see OPERATIONS.md).</p>
      {msg && <p role="status">{msg}</p>}
      <button disabled={busy} onClick={run}>{busy ? "Running..." : "Run now"}</button>
    </div>
  );
}
