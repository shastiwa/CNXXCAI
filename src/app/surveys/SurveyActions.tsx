"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const OPEN = ["PENDING", "SENT", "VIEWED"];

export default function SurveyActions({ id, status, replaced }: { id: string; status: string; replaced: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const canCancel = OPEN.includes(status);
  const canReopen = !OPEN.includes(status) && !replaced;

  async function act(kind: "cancel" | "reopen") {
    const reason = window.prompt(kind === "cancel" ? "Why is this survey being cancelled?" : "Why is this survey being reopened?");
    if (!reason) return;
    if (!window.confirm(kind === "cancel" ? "Cancel this survey? The link will stop working." : "Reopen this survey? The requester will be able to answer again.")) return;
    setBusy(true);
    setMsg("");
    const res = await fetch(`/api/surveys/${id}/${kind}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(body.error ?? "Failed."); return; }
    if (body.link) setMsg(`Reopened. New link: ${body.link}`);
    router.refresh();
  }

  return (
    <div>
      {canCancel && <button className="secondary" disabled={busy} onClick={() => act("cancel")}>Cancel</button>}
      {canReopen && <button className="secondary" disabled={busy} onClick={() => act("reopen")}>Reopen</button>}
      {msg && <div role="status" className="muted" style={{ wordBreak: "break-all" }}>{msg}</div>}
    </div>
  );
}
