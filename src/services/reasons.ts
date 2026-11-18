import { z } from "zod";
import { db } from "@/lib/db";

export const OTHER_REASON = "Other";

export const DEFAULT_REASONS = [
  "Resolution was incomplete",
  "Resolution took too long",
  "Issue was not resolved properly",
  "Poor communication from support team",
  "Support engineer was unhelpful",
  "Issue still persists",
  OTHER_REASON,
];

export const reasonsInput = z
  .array(z.string().trim().min(1).max(100))
  .min(1)
  .max(20)
  .transform((a) => [...new Set(a)]);

/** Active reasons in display order. Seeds the defaults the first time, when the table has never been used. */
export async function getActiveReasons(): Promise<string[]> {
  const read = () => db.surveyReason.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] });
  let rows = await read();
  if (rows.length === 0 && (await db.surveyReason.count()) === 0) {
    await setReasons(DEFAULT_REASONS);
    rows = await read();
  }
  return rows.map((r) => r.label);
}

/** Replaces the list. Reasons left out are turned off, not deleted, so old responses keep their wording. */
export async function setReasons(labels: string[]): Promise<string[]> {
  const list = reasonsInput.parse(labels);
  await db.$transaction([
    ...list.map((label, i) =>
      db.surveyReason.upsert({ where: { label }, create: { label, sortOrder: i }, update: { sortOrder: i, active: true } }),
    ),
    db.surveyReason.updateMany({ where: { label: { notIn: list } }, data: { active: false } }),
  ]);
  return list;
}
