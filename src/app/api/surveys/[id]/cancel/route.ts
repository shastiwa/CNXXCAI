import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { errorResponse, requireRole } from "@/lib/auth";
import { readJson } from "@/lib/http";
import { ROLES_MANAGE_SURVEYS } from "@/lib/roles";
import { cancelInvite } from "@/services/lifecycle";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole(...ROLES_MANAGE_SURVEYS);
    const { id } = await ctx.params;
    await cancelInvite(user, id, await readJson(req));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "A reason of 3 to 300 characters is required" }, { status: 400 });
    return errorResponse(e);
  }
}
