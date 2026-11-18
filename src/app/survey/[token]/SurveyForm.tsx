"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Sat = "SATISFIED" | "UNSATISFIED";

export default function SurveyForm({ token, initial }: { token: string; initial?: Sat }) {
  const router = useRouter();
  const [sat, setSat] = useState<Sat | undefined>(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!sat) return setError("Please choose how you feel about the resolution.");
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const loss = String(f.get("loss") ?? "").trim();
    const reason = String(f.get("reason") ?? "").trim();
    const comments = String(f.get("comments") ?? "").trim();
    const res = await fetch("/api/survey/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token,
        satisfaction: sat,
        productivityLossMin: loss ? Number(loss) : undefined,
        dissatisfactionReason: sat === "UNSATISFIED" && reason ? reason : undefined,
        callbackPreference: sat === "UNSATISFIED" ? f.get("callback") : "NONE",
        comments: comments || undefined,
      }),
    });
    if (res.ok) return router.push("/thank-you");
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Could not submit. Please try again.");
    setBusy(false);
  }

  return (
    // method="post": if JavaScript fails to start, comments are never put in the URL or logs.
    <form className="card" method="post" action="/api/survey/submit" onSubmit={onSubmit}>
      <div className="row" role="radiogroup" aria-label="Satisfaction">
        <button type="button" className={sat === "SATISFIED" ? "" : "secondary"} onClick={() => setSat("SATISFIED")}>
          Satisfied
        </button>
        <button type="button" className={sat === "UNSATISFIED" ? "bad" : "secondary"} onClick={() => setSat("UNSATISFIED")}>
          Unsatisfied
        </button>
      </div>

      <label htmlFor="loss">Minutes of work lost (optional)</label>
      <input id="loss" name="loss" type="number" min={0} max={100000} />

      {sat === "UNSATISFIED" && (
        <>
          <label htmlFor="reason">What went wrong?</label>
          <select id="reason" name="reason" defaultValue="">
            <option value="">Select...</option>
            <option>Took too long</option>
            <option>Issue not fully fixed</option>
            <option>Poor communication</option>
            <option>Other</option>
          </select>
          <label htmlFor="callback">Would you like a call back?</label>
          <select id="callback" name="callback" defaultValue="NONE">
            <option value="NONE">No</option>
            <option value="EMAIL">By email</option>
            <option value="PHONE">By phone</option>
          </select>
        </>
      )}

      <label htmlFor="comments">Comments (optional)</label>
      <textarea id="comments" name="comments" rows={4} maxLength={2000} />
      <p className="muted">Please do not include passwords or personal details in comments.</p>

      {error && <p className="err" role="alert">{error}</p>}
      <p><button disabled={busy}>{busy ? "Sending..." : "Submit"}</button></p>
    </form>
  );
}
