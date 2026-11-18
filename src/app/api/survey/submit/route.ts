import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { errorResponse, HttpError } from "@/lib/auth";
import { readJson } from "@/lib/http";
import type { UploadedFile } from "@/services/attachments";
import { getSettings } from "@/services/settings";
import { submitResponse } from "@/services/survey";

const text = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() !== "" ? v : undefined);

/** JSON (no files) or multipart/form-data (with files). Anything else is a client error. */
async function readSubmission(req: Request): Promise<{ raw: unknown; files: UploadedFile[] }> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.startsWith("multipart/form-data")) return { raw: await readJson(req), files: [] };

  const s = await getSettings();
  const limit = (s.maxFiles * s.maxFileMb + 1) * 1024 * 1024;
  if (Number(req.headers.get("content-length") ?? 0) > limit) throw new HttpError(413, "The upload is too large.");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "Request body could not be read");
  }
  const loss = text(form.get("productivityLossMin"));
  const raw = {
    token: text(form.get("token")),
    satisfaction: text(form.get("satisfaction")),
    productivityLossMin: loss === undefined ? undefined : Number(loss),
    dissatisfactionReason: text(form.get("dissatisfactionReason")),
    callbackPreference: text(form.get("callbackPreference")),
    comments: text(form.get("comments")),
  };
  const files: UploadedFile[] = [];
  for (const entry of form.getAll("files")) {
    if (typeof entry === "string" || entry.size === 0) continue; // empty file picker
    files.push({ name: entry.name, bytes: Buffer.from(await entry.arrayBuffer()) });
  }
  return { raw, files };
}

export async function POST(req: Request) {
  try {
    const { raw, files } = await readSubmission(req);
    return NextResponse.json(await submitResponse(raw, files), { status: 201 });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    return errorResponse(e);
  }
}
