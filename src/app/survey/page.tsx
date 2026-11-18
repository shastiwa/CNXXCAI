import { redirect } from "next/navigation";
import { HttpError } from "@/lib/auth";
import { openSurveyForIncident } from "@/services/survey";

export const dynamic = "force-dynamic";

/** Entry point for the link Helix emails: /survey?incident=<number>&key=<id>&r=SATISFIED|UNSATISFIED */
export default async function SurveyEntry({
  searchParams,
}: {
  searchParams: Promise<{ incident?: string; key?: string; r?: string }>;
}) {
  const { incident, key, r } = await searchParams;

  let token: string;
  try {
    token = (await openSurveyForIncident({ incident, key })).token;
  } catch (e) {
    const msg = e instanceof HttpError ? e.message : "Something went wrong.";
    return (
      <main style={{ maxWidth: 560 }}>
        <h1>Survey unavailable</h1>
        <p className="muted">{msg}</p>
      </main>
    );
  }

  const answer = r === "SATISFIED" || r === "UNSATISFIED" ? `?r=${r}` : "";
  redirect(`/survey/${token}${answer}`); // outside try/catch: redirect works by throwing
}
