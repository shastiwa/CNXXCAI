import { NextResponse } from "next/server";
import { errorResponse, requireRole } from "@/lib/auth";
import { listResponses } from "@/services/responses";

export async function GET(req: Request) {
  try {
    const user = await requireRole("ADMIN", "EXPERIENCE_TEAM", "SUPPORT_GROUP", "CIO");
    const s = new URL(req.url).searchParams.get("satisfaction");
    const satisfaction = s === "SATISFIED" || s === "UNSATISFIED" ? s : undefined;
    return NextResponse.json(await listResponses(user, { satisfaction }));
  } catch (e) {
    return errorResponse(e);
  }
}
