import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { errorResponse, HttpError, requireRole } from "@/lib/auth";
import { ROLES_WORK_CASES } from "@/lib/roles";
import { db } from "@/lib/db";
import { pushCaseToBwf } from "@/services/survey";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole(...ROLES_WORK_CASES);
    const { id } = await ctx.params;
    const rc = await db.recoveryCase.findUnique({ where: { id } });
    if (!rc) throw new HttpError(404, "Case not found");
    if (rc.status === "CREATED") throw new HttpError(409, "Case already created");
    const updated = await pushCaseToBwf(id);
    await audit(user.id, "case.retry", id, updated.status);
    return NextResponse.json(updated);
  } catch (e) {
    return errorResponse(e);
  }
}
