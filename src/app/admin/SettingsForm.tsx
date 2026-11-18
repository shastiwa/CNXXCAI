"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Settings {
  expiryDays: number; maxFileMb: number; maxFiles: number; allowedExtensions: string[]; showRequestSummary: boolean;
}
const ALL_TYPES = ["png", "jpg", "jpeg", "pdf", "txt", "docx", "xlsx"];

export default function SettingsForm({ initial, reasons }: { initial: Settings; reasons: string[] }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [reasonText, setReasonText] = useState(reasons.join("\n"));
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    // Confirm before a change that affects every survey link that is still open.
    if (!window.confirm("Save these survey settings? They apply to new surveys and new submissions straight away.")) return;
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: s, reasons: reasonText.split("\n").map((x) => x.trim()).filter(Boolean) }),
    });
    setBusy(false);
    if (res.ok) { setMsg("Saved."); router.refresh(); }
    else setMsg((await res.json().catch(() => ({}))).error ?? "Could not save.");
  }

  const num = (k: "expiryDays" | "maxFileMb" | "maxFiles") => (e: React.ChangeEvent<HTMLInputElement>) =>
    setS({ ...s, [k]: Number(e.target.value) });

  return (
    <form className="card" onSubmit={save}>
      <label htmlFor="expiry">Survey link expires after (days)</label>
      <input id="expiry" type="number" min={1} max={90} value={s.expiryDays} onChange={num("expiryDays")} />
      <label htmlFor="mf">Maximum files per response (0 turns attachments off)</label>
      <input id="mf" type="number" min={0} max={10} value={s.maxFiles} onChange={num("maxFiles")} />
      <label htmlFor="mb">Maximum size per file (MB, up to 20)</label>
      <input id="mb" type="number" min={1} max={20} value={s.maxFileMb} onChange={num("maxFileMb")} />
      <fieldset style={{ border: 0, padding: 0, margin: "12px 0 0" }}>
        <legend style={{ fontWeight: 600 }}>Allowed file types</legend>
        <div className="row">
          {ALL_TYPES.map((t) => (
            <label key={t} style={{ fontWeight: 400, display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
              <input type="checkbox" style={{ width: "auto" }} checked={s.allowedExtensions.includes(t)}
                onChange={(e) => setS({ ...s, allowedExtensions: e.target.checked ? [...s.allowedExtensions, t] : s.allowedExtensions.filter((x) => x !== t) })} />
              {t}
            </label>
          ))}
        </div>
      </fieldset>
      <label style={{ fontWeight: 400, display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" style={{ width: "auto" }} checked={s.showRequestSummary}
          onChange={(e) => setS({ ...s, showRequestSummary: e.target.checked })} />
        Show the request summary on the survey page
      </label>
      <label htmlFor="reasons">Dissatisfaction reasons (one per line)</label>
      <textarea id="reasons" rows={8} value={reasonText} onChange={(e) => setReasonText(e.target.value)} />
      <p className="muted">Reasons you remove are turned off, not deleted, so old responses keep their wording.</p>
      {msg && <p role="status" className={msg === "Saved." ? "" : "err"}>{msg}</p>}
      <p><button disabled={busy}>{busy ? "Saving..." : "Save settings"}</button></p>
    </form>
  );
}
