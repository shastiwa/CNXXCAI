import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "@/lib/auth";
import { env } from "@/lib/env";
import type { AppSettings } from "./settings";

export interface UploadedFile {
  name: string;
  bytes: Buffer;
}

export interface StoredFile {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  sha256: string;
}

const TYPES: Record<string, { contentType: string; matches: (b: Buffer) => boolean }> = {
  png: { contentType: "image/png", matches: (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
  jpg: { contentType: "image/jpeg", matches: (b) => b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) },
  jpeg: { contentType: "image/jpeg", matches: (b) => b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) },
  pdf: { contentType: "application/pdf", matches: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  // docx and xlsx are zip files
  docx: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", matches: isZip },
  xlsx: { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", matches: isZip },
  // plain text: no NUL bytes
  txt: { contentType: "text/plain", matches: (b) => !b.includes(0) },
};

function isZip(b: Buffer) {
  return b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
}

const KEY_PATTERN = /^[a-f0-9]{32}\.[a-z]{3,4}$/;

/** Keep only a safe display name. It is never used as a path. */
export function cleanFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^\w.\- ()]/g, "_").replace(/\.{2,}/g, ".").trim().slice(0, 100);
  return cleaned || "file";
}

/**
 * Checks every file before anything is written: count, size, extension, and that the first bytes
 * match the extension (so a renamed program is refused). The browser's content type is ignored.
 */
export function validateFiles(files: UploadedFile[], s: Pick<AppSettings, "maxFiles" | "maxFileMb" | "allowedExtensions">): StoredFile[] {
  if (files.length === 0) return [];
  if (s.maxFiles === 0) throw new HttpError(400, "Attachments are turned off.");
  if (files.length > s.maxFiles) throw new HttpError(400, `You can attach at most ${s.maxFiles} files.`);
  const maxBytes = s.maxFileMb * 1024 * 1024;
  return files.map((f) => {
    const fileName = cleanFileName(f.name);
    const ext = path.extname(fileName).slice(1).toLowerCase();
    const type = TYPES[ext];
    if (!type || !(s.allowedExtensions as string[]).includes(ext)) {
      throw new HttpError(400, `${fileName}: this file type is not allowed. Allowed: ${s.allowedExtensions.join(", ")}.`);
    }
    if (f.bytes.length === 0) throw new HttpError(400, `${fileName}: the file is empty.`);
    if (f.bytes.length > maxBytes) throw new HttpError(400, `${fileName}: the file is larger than ${s.maxFileMb} MB.`);
    if (!type.matches(f.bytes)) throw new HttpError(400, `${fileName}: the file content does not match its type.`);
    return {
      fileName,
      contentType: type.contentType,
      sizeBytes: f.bytes.length,
      storageKey: `${randomBytes(16).toString("hex")}.${ext}`,
      sha256: createHash("sha256").update(f.bytes).digest("hex"),
    };
  });
}

// The upload folder is set at run time (UPLOAD_DIR) and is not part of the app code, so the build
// must not try to trace it into the deployment.
const dir = () => path.resolve(/*turbopackIgnore: true*/ process.cwd(), env().UPLOAD_DIR);

function pathFor(storageKey: string) {
  if (!KEY_PATTERN.test(storageKey)) throw new Error("invalid storage key");
  return path.join(/*turbopackIgnore: true*/ dir(), storageKey);
}

/** Writes the files. If one write fails, the ones already written are removed. */
export async function writeFiles(files: UploadedFile[], stored: StoredFile[]) {
  await mkdir(dir(), { recursive: true });
  const done: string[] = [];
  try {
    for (let i = 0; i < files.length; i++) {
      await writeFile(pathFor(stored[i].storageKey), files[i].bytes, { flag: "wx" });
      done.push(stored[i].storageKey);
    }
  } catch (e) {
    await removeFiles(done);
    throw e;
  }
}

export async function removeFiles(keys: string[]) {
  await Promise.all(keys.map((k) => rm(pathFor(k), { force: true }).catch(() => undefined)));
}

export async function readStoredFile(storageKey: string): Promise<Buffer> {
  return readFile(pathFor(storageKey));
}
