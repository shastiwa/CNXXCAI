import Link from "next/link";

export default function Landing() {
  return (
    <main>
      <h1>SolvNow XC AI</h1>
      <p className="muted">
        After a Helix incident is resolved, the requester gets a short survey. An unsatisfied answer
        opens a recovery case for the Experience Management Team.
      </p>
      <Link className="btn" href="/login">Staff sign in</Link>
    </main>
  );
}
