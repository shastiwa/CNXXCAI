import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { audit } from "@/lib/audit";
import { errorResponse, requireRole } from "@/lib/auth";
import { ROLES_EXPORT } from "@/lib/roles";
import { parseFilters } from "@/services/analytics";
import { buildWorkbook } from "@/services/export";

// Excel file of the viewer's own dashboard view. No requester email, no comments. Each export is audit logged.
export async function GET(req: Request) {
  try {
    const user = await requireRole(...ROLES_EXPORT);
    const filters = parseFilters(new URL(req.url).searchParams);
    const file = await buildWorkbook(user, filters);
    await audit(user.id, "dashboard.export", "xlsx", Object.entries(filters).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(", ").slice(0, 300));
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="survey-analytics-${new Date().toISOString().slice(0, 10)}.xlsx"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "Invalid filter" }, { status: 400 });
    return errorResponse(e);
  }
}
