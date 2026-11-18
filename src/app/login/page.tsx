"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const next = useSearchParams().get("next");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: f.get("email"), password: f.get("password"), next }),
    });
    const data = await res.json();
    if (res.ok) window.location.assign(data.redirect);
    else { setError(data.error ?? "Sign in failed"); setBusy(false); }
  }

  return (
    <main style={{ maxWidth: 420 }}>
      <h1>Sign in</h1>
      {/* method="post": if JavaScript fails to start, credentials are never put in the URL or logs. */}
      <form className="card" method="post" action="/api/auth/login" onSubmit={onSubmit}>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="username" />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" />
        {error && <p className="err" role="alert">{error}</p>}
        <p><button disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button></p>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
