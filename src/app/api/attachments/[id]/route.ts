import { audit } from "@/lib/audit";
import { errorResponse, HttpError, requireRole } from "@/lib/auth";
import { ROLES_OPEN_ATTACHMENTS } from "@/lib/roles";
import { readStoredFile } from "@/services/attachments";
import { findAttachmentForViewer } from "@/services/responses";

// Staff only. Group users can open only their own group's files. Always a download, never shown inline.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole(...ROLES_OPEN_ATTACHMENTS);
    const { id } = await ctx.params;
    const file = await findAttachmentForViewer(user, id);
    if (!file) throw new HttpError(404, "Not found"); // same answer for "missing" and "not yours"
    const bytes = await readStoredFile(file.storageKey).catch(() => null);
    if (!bytes) throw new HttpError(404, "Not found");
    await audit(user.id, "attachment.download", file.id);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": file.contentType,
        "content-disposition": `attachment; filename="${file.fileName.replace(/"/g, "")}"`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
