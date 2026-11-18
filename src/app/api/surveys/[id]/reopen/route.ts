import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { errorResponse, requireRole } from "@/lib/auth";
import { readJson } from "@/lib/http";
import { ROLES_MANAGE_SURVEYS } from "@/lib/roles";
import { reopenInvite } from "@/services/lifecycle";

// The result holds a survey link (a secret for that survey), so it goes only to the person who reopened it.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole(...ROLES_MANAGE_SURVEYS);
    const { id } = await ctx.params;
    const res = await reopenInvite(user, id, await readJson(req));
    return NextResponse.json({ link: res.link }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "A reason of 3 to 300 characters is required" }, { status: 400 });
    return errorResponse(e);
  }
}
