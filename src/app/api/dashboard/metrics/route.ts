import { NextResponse } from "next/server";
import { errorResponse, requireRole } from "@/lib/auth";
import { getDashboardMetrics } from "@/services/metrics";

export async function GET() {
  try {
    const user = await requireRole("ADMIN", "EXPERIENCE_TEAM", "SUPPORT_GROUP", "CIO");
    return NextResponse.json(await getDashboardMetrics(user));
  } catch (e) {
    return errorResponse(e);
  }
}
