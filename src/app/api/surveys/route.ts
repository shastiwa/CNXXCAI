import { NextResponse } from "next/server";
import type { InviteStatus } from "@prisma/client";
import { errorResponse, HttpError, requireRole } from "@/lib/auth";
import { ROLES_VIEW_DATA } from "@/lib/roles";
import { ALL_STATUSES, listSurveys } from "@/services/tracking";

export async function GET(req: Request) {
  try {
    const user = await requireRole(...ROLES_VIEW_DATA);
    const status = new URL(req.url).searchParams.get("status");
    if (status && !ALL_STATUSES.includes(status as InviteStatus)) throw new HttpError(400, "Unknown status");
    return NextResponse.json(await listSurveys(user, { status: (status as InviteStatus) || undefined }));
  } catch (e) {
    return errorResponse(e);
  }
}
