import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/** File types the survey can accept. Each one has a signature check in attachments.ts. */
export const SUPPORTED_FILE_TYPES = ["png", "jpg", "jpeg", "pdf", "txt", "docx", "xlsx"] as const;

export const settingsSchema = z.object({
  expiryDays: z.number().int().min(1).max(90),
  maxFileMb: z.number().int().min(1).max(20),
  /** 0 turns attachments off. */
  maxFiles: z.number().int().min(0).max(10),
  allowedExtensions: z.array(z.enum(SUPPORTED_FILE_TYPES)).max(SUPPORTED_FILE_TYPES.length),
  showRequestSummary: z.boolean(),
});
export type AppSettings = z.infer<typeof settingsSchema>;

const KEY = "survey.config";

function defaults(): AppSettings {
  return {
    expiryDays: env().SURVEY_EXPIRY_DAYS,
    maxFileMb: 5,
    maxFiles: 3,
    allowedExtensions: ["png", "jpg", "jpeg", "pdf", "txt", "docx"],
    showRequestSummary: true,
  };
}

/** Stored values override the defaults. Anything invalid in the database falls back to the defaults. */
export async function getSettings(): Promise<AppSettings> {
  const base = defaults();
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  if (!row) return base;
  try {
    const parsed = settingsSchema.safeParse({ ...base, ...JSON.parse(row.value) });
    return parsed.success ? parsed.data : base;
  } catch {
    return base;
  }
}

/** Validates the merged result, so a bad value never reaches the database. Throws a ZodError. */
export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = settingsSchema.parse({ ...(await getSettings()), ...patch });
  const value = JSON.stringify(next);
  await db.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  return next;
}
