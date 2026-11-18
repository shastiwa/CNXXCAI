import { Role, type User } from "@prisma/client";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { HttpError } from "@/lib/auth";
import { db } from "@/lib/db";

const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

export const userUpdateInput = z
  .object({
    role: z.enum(Role),
    supportGroup: z.string().max(100).nullish(),
    agentName: z.string().max(200).nullish(),
    active: z.boolean(),
  })
  .strict();

/**
 * Admin edits an existing user's role, group, agent name and active flag. Passwords and new users are not
 * handled here. Group and agent name are kept only for the roles that use them.
 */
export async function updateUser(actor: Pick<User, "id">, targetId: string, raw: unknown) {
  const input = userUpdateInput.parse(raw);
  const supportGroup = input.role === "SUPPORT_GROUP" ? blank(input.supportGroup) : null;
  const agentName = input.role === "SUPPORT_AGENT" ? blank(input.agentName) : null;
  if (input.role === "SUPPORT_GROUP" && !supportGroup) throw new HttpError(400, "A Support Group Manager needs a support group.");
  if (input.role === "SUPPORT_AGENT" && !agentName) throw new HttpError(400, "A Support Agent needs an agent name (as Helix shows it).");

  // No self-edits: an admin cannot lock themselves out or drop their own rights by mistake.
  if (actor.id === targetId) throw new HttpError(400, "You cannot change your own role or active state.");

  const target = await db.user.findUnique({ where: { id: targetId } });
  if (!target) throw new HttpError(404, "User not found");

  const losesAdmin = target.role === "ADMIN" && target.active && (input.role !== "ADMIN" || !input.active);
  if (losesAdmin) {
    const others = await db.user.count({ where: { role: "ADMIN", active: true, id: { not: targetId } } });
    if (others === 0) throw new HttpError(409, "At least one active System Administrator must remain.");
  }

  const updated = await db.user.update({
    where: { id: targetId },
    data: { role: input.role, supportGroup, agentName, active: input.active },
    select: { id: true, email: true, role: true, supportGroup: true, agentName: true, active: true },
  });
  const changes = [
    target.role !== updated.role && `role ${target.role}->${updated.role}`,
    target.active !== updated.active && `active ${target.active}->${updated.active}`,
    target.supportGroup !== updated.supportGroup && "group",
    target.agentName !== updated.agentName && "agentName",
  ].filter(Boolean).join(", ");
  await audit(actor.id, "user.update", targetId, changes || "no change");
  return updated;
}
