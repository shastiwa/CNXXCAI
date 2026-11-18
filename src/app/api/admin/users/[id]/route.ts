import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { errorResponse, requireRole } from "@/lib/auth";
import { readJson } from "@/lib/http";
import { ROLES_ADMIN } from "@/lib/roles";
import { updateUser } from "@/services/users";

// System administrators only. Changes apply on the user's next request (ADR-006).
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole(...ROLES_ADMIN);
    const { id } = await ctx.params;
    return NextResponse.json(await updateUser(actor, id, await readJson(req)));
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    return errorResponse(e);
  }
}
