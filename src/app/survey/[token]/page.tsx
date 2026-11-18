import { HttpError } from "@/lib/auth";
import { getSurveyContext } from "@/services/survey";
import SurveyForm from "./SurveyForm";

export const dynamic = "force-dynamic";

export default async function SurveyPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ r?: string }>;
}) {
  const { token } = await params;
  const { r } = await searchParams;

  let ctx: Awaited<ReturnType<typeof getSurveyContext>>;
  try {
    ctx = await getSurveyContext(token);
  } catch (e) {
    const msg = e instanceof HttpError ? e.message : "Something went wrong";
    return (
      <main className="survey">
        <h1>Survey unavailable</h1>
        <p className="muted">{msg}.</p>
      </main>
    );
  }

  const initial = r === "SATISFIED" || r === "UNSATISFIED" ? r : undefined;
  const resolved = ctx.resolvedAt ? ctx.resolvedAt.toISOString().slice(0, 10) : null;
  const details: [string, string][] = [
    ["Request", ctx.incidentId],
    ...(ctx.requestSummary ? [["Summary", ctx.requestSummary] as [string, string]] : []),
    ...(ctx.serviceName ? [["Service", ctx.serviceName] as [string, string]] : []),
    ["Support group", ctx.supportGroup],
    ...(resolved ? [["Resolved on", resolved] as [string, string]] : []),
  ];

  return (
    <main className="survey">
      <h1>How was your support?</h1>
      <p className="muted">Your request was marked resolved. It takes under a minute.</p>
      <dl className="card details" aria-label="Request details">
        {details.map(([k, v]) => (
          <div key={k}><dt className="muted">{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      <SurveyForm token={token} initial={initial} reasons={ctx.reasons} uploads={ctx.uploads} />
    </main>
  );
}
