import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { errorResponse, requireRole } from "@/lib/auth";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/webhook";
import { runLifecycleJobs } from "@/services/lifecycle";

// Expires overdue surveys and sends reminders. Called by a scheduler with the X-Jobs-Secret header, or by an
// admin who is signed in. A wrong secret is refused outright and never falls back to the login check.
export async function POST(req: Request) {
  try {
    const given = req.headers.get("x-jobs-secret");
    let actor: string | null = null;
    if (given !== null) {
      const secret = env().JOBS_SECRET;
      if (!secret || !safeEqual(given, secret)) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    } else {
      actor = (await requireRole("ADMIN")).id;
    }
    const result = await runLifecycleJobs();
    await audit(actor, "jobs.run", "lifecycle", `expired ${result.expired}, reminders sent ${result.reminders.sent}`);
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
