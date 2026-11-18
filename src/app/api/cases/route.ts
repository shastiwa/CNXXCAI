import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { errorResponse, requireRole } from "@/lib/auth";
import { ROLES_WORK_CASES } from "@/lib/roles";

// ADR-005: role-gated only. Not group-scoped by design (central Experience team owns all cases).
export async function GET() {
  try {
    await requireRole(...ROLES_WORK_CASES);
    const cases = await db.recoveryCase.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { response: { include: { invite: true } } },
    });
    return NextResponse.json(cases);
  } catch (e) {
    return errorResponse(e);
  }
}
