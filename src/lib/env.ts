import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(8),
  HELIX_WEBHOOK_SECRET: z.string().min(8),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  SURVEY_EXPIRY_DAYS: z.coerce.number().int().positive().default(7),
  HELIX_MODE: z.enum(["mock", "live"]).default("mock"),
  BWF_MODE: z.enum(["mock", "live"]).default("mock"),
  // Live Helix (only needed when HELIX_MODE=live). Secrets: never commit or log.
  HELIX_BASE_URL: z.string().url().optional(),
  HELIX_USERNAME: z.string().min(1).optional(),
  HELIX_PASSWORD: z.string().min(1).optional(),
  HELIX_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  // Comma-separated Helix status values that count as "resolved".
  HELIX_RESOLVED_STATUSES: z.string().default("Resolved,Closed"),
  // Optional JSON that renames the Helix fields used for request details, for example
  // {"summary":"Description","serviceName":"Service"}. Unset keys keep the defaults in live.ts.
  HELIX_DETAIL_FIELDS: z.string().optional(),
  // Where survey attachments are stored (outside the web root). Never serve this folder directly.
  UPLOAD_DIR: z.string().min(1).default("uploads"),
  // How reminders are delivered. "off" sends nothing (the job only reports what is due). "mock" is for tests.
  // No live delivery exists yet: it needs an email or Helix notification method.
  REMINDER_MODE: z.enum(["off", "mock"]).default("off"),
  // Lets a scheduler call POST /api/jobs/run without a login. Optional; without it only an admin can run jobs.
  JOBS_SECRET: z.string().min(16).optional(),
});

let cached: z.infer<typeof schema> | undefined;

/** Validated env, read lazily so `next build` works without secrets. */
export function env() {
  return (cached ??= schema.parse(process.env));
}
