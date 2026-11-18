"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Sat = "SATISFIED" | "UNSATISFIED";
interface Uploads { maxFiles: number; maxFileMb: number; allowedExtensions: string[] }

export default function SurveyForm({
  token, initial, reasons, uploads,
}: { token: string; initial?: Sat; reasons: string[]; uploads: Uploads }) {
  const router = useRouter();
  const [sat, setSat] = useState<Sat | undefined>(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canAttach = uploads.maxFiles > 0 && uploads.allowedExtensions.length > 0;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!sat) return setError("Please choose how you feel about the resolution.");
    const f = new FormData(e.currentTarget);

    // Check files here for a quick message. The server checks again and is the real gate.
    const files = f.getAll("files").filter((x): x is File => x instanceof File && x.size > 0);
    if (files.length > uploads.maxFiles) return setError(`You can attach at most ${uploads.maxFiles} files.`);
    const tooBig = files.find((x) => x.size > uploads.maxFileMb * 1024 * 1024);
    if (tooBig) return setError(`${tooBig.name} is larger than ${uploads.maxFileMb} MB.`);

    setBusy(true);
    setError("");
    const body = new FormData();
    body.set("token", token);
    body.set("satisfaction", sat);
    for (const k of ["loss", "reason", "callback", "comments"] as const) {
      const v = String(f.get(k) ?? "").trim();
      if (!v) continue;
      if (k === "loss") body.set("productivityLossMin", v);
      else if (k === "reason") { if (sat === "UNSATISFIED") body.set("dissatisfactionReason", v); }
      else if (k === "callback") { if (sat === "UNSATISFIED") body.set("callbackPreference", v); }
      else body.set("comments", v);
    }
    if (sat === "UNSATISFIED") files.forEach((x) => body.append("files", x));

    try {
      const res = await fetch("/api/survey/submit", { method: "POST", body });
      if (res.ok) return router.push("/thank-you");
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not submit. Please try again.");
    } catch {
      setError("Could not reach the server. Please check your connection and try again.");
    }
    setBusy(false);
  }

  return (
    // method="post": if JavaScript fails to start, comments are never put in the URL or logs.
    <form className="card" method="post" action="/api/survey/submit" onSubmit={onSubmit}>
      <div className="row choice" role="radiogroup" aria-label="Satisfaction">
        <button type="button" role="radio" aria-checked={sat === "SATISFIED"} className={sat === "SATISFIED" ? "" : "secondary"} onClick={() => setSat("SATISFIED")}>
          Satisfied
        </button>
        <button type="button" role="radio" aria-checked={sat === "UNSATISFIED"} className={sat === "UNSATISFIED" ? "bad" : "secondary"} onClick={() => setSat("UNSATISFIED")}>
          Unsatisfied
        </button>
      </div>

      {sat === "UNSATISFIED" && (
        <>
          <label htmlFor="reason">What went wrong?</label>
          <select id="reason" name="reason" defaultValue="">
            <option value="">Select a reason (optional)</option>
            {reasons.map((r) => <option key={r}>{r}</option>)}
          </select>
          <label htmlFor="callback">Would you like a call back?</label>
          <select id="callback" name="callback" defaultValue="NONE">
            <option value="NONE">No</option>
            <option value="EMAIL">By email</option>
            <option value="PHONE">By phone</option>
          </select>
        </>
      )}

      <label htmlFor="loss">Minutes of work lost (optional)</label>
      <input id="loss" name="loss" type="number" inputMode="numeric" min={0} max={100000} />

      <label htmlFor="comments">
        {sat === "SATISFIED" ? "Anything that went well? (optional)" : "Comments (optional)"}
      </label>
      <textarea id="comments" name="comments" rows={4} maxLength={2000} />
      <p className="muted">Please do not include passwords or personal details in comments.</p>

      {sat === "UNSATISFIED" && canAttach && (
        <>
          <label htmlFor="files">Screenshots or documents (optional)</label>
          <input id="files" name="files" type="file" multiple
            accept={uploads.allowedExtensions.map((x) => `.${x}`).join(",")} />
          <p className="muted">
            Up to {uploads.maxFiles} files, {uploads.maxFileMb} MB each. Allowed: {uploads.allowedExtensions.join(", ")}.
            Do not attach files with passwords or other people&apos;s personal data.
          </p>
        </>
      )}

      {error && <p className="err" role="alert">{error}</p>}
      <p><button disabled={busy}>{busy ? "Sending..." : "Submit"}</button></p>
    </form>
  );
}
