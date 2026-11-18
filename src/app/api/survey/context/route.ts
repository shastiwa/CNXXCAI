import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/auth";
import { getSurveyContext } from "@/services/survey";

export async function GET(req: Request) {
  try {
    const token = new URL(req.url).searchParams.get("token") ?? "";
    return NextResponse.json(await getSurveyContext(token));
  } catch (e) {
    return errorResponse(e);
  }
}
