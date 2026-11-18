import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { audit } from "@/lib/audit";
import { errorResponse, requireRole } from "@/lib/auth";
import { readJson } from "@/lib/http";
import { getActiveReasons, reasonsInput, setReasons } from "@/services/reasons";
import { getSettings, saveSettings, settingsSchema } from "@/services/settings";

const body = z.object({
  settings: settingsSchema.partial().optional(),
  reasons: reasonsInput.optional(),
}).strict();

// System administrators only. Nothing here is a secret: credentials stay in environment variables.
export async function GET() {
  try {
    await requireRole("ADMIN");
    return NextResponse.json({ settings: await getSettings(), reasons: await getActiveReasons() });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: Request) {
  try {
    const user = await requireRole("ADMIN");
    const input = body.parse(await readJson(req));
    if (input.settings) {
      await saveSettings(input.settings);
      await audit(user.id, "settings.update", "survey.config", Object.keys(input.settings).join(","));
    }
    if (input.reasons) {
      await setReasons(input.reasons);
      await audit(user.id, "reasons.update", "survey.reasons", `${input.reasons.length} reasons`);
    }
    return NextResponse.json({ settings: await getSettings(), reasons: await getActiveReasons() });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    return errorResponse(e);
  }
}
