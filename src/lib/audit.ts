import { db } from "./db";

/** Never pass secrets, tokens or passwords in `detail`. */
export async function audit(actorId: string | null, action: string, target?: string, detail?: string) {
  await db.auditLog.create({ data: { actorId, action, target, detail } });
}
