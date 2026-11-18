import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { errorResponse } from "@/lib/auth";
import { readJson } from "@/lib/http";
import { submitResponse } from "@/services/survey";

export async function POST(req: Request) {
  try {
    return NextResponse.json(await submitResponse(await readJson(req)), { status: 201 });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    return errorResponse(e);
  }
}
