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

  let incidentId: string;
  try {
    incidentId = (await getSurveyContext(token)).incidentId;
  } catch (e) {
    const msg = e instanceof HttpError ? e.message : "Something went wrong";
    return (
      <main style={{ maxWidth: 560 }}>
        <h1>Survey unavailable</h1>
        <p className="muted">{msg}.</p>
      </main>
    );
  }

  const initial = r === "SATISFIED" || r === "UNSATISFIED" ? r : undefined;
  return (
    <main style={{ maxWidth: 560 }}>
      <h1>How was your support?</h1>
      <p className="muted">Incident {incidentId} was marked resolved. It takes under a minute.</p>
      <SurveyForm token={token} initial={initial} />
    </main>
  );
}
