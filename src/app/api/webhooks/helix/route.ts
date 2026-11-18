import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { env } from "@/lib/env";
import { validSignature } from "@/lib/webhook";
import { errorResponse } from "@/lib/auth";
import { readJson } from "@/lib/http";
import { createInvite, inviteInput } from "@/services/survey";

export async function POST(req: Request) {
  try {
    if (!validSignature(req.headers.get("x-helix-signature"), env().HELIX_WEBHOOK_SECRET)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    const body = inviteInput.parse(await readJson(req));
    return NextResponse.json(await createInvite(body, { handedToHelix: true }), { status: 201 });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    return errorResponse(e);
  }
}
