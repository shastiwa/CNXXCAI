import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { errorResponse, requireRole } from "@/lib/auth";
import { ROLES_VIEW_DATA } from "@/lib/roles";
import { getAnalytics, parseFilters } from "@/services/analytics";

export async function GET(req: Request) {
  try {
    const user = await requireRole(...ROLES_VIEW_DATA);
    return NextResponse.json(await getAnalytics(user, parseFilters(new URL(req.url).searchParams)));
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "Invalid filter" }, { status: 400 });
    return errorResponse(e);
  }
}
