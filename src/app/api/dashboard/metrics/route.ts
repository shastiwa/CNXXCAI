import { NextResponse } from "next/server";
import { errorResponse, requireRole } from "@/lib/auth";
import { ROLES_VIEW_DATA } from "@/lib/roles";
import { getDashboardMetrics } from "@/services/metrics";

export async function GET() {
  try {
    const user = await requireRole(...ROLES_VIEW_DATA);
    return NextResponse.json(await getDashboardMetrics(user));
  } catch (e) {
    return errorResponse(e);
  }
}
