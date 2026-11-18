import type { InviteStatus, User } from "@prisma/client";
import { db } from "@/lib/db";
import { ROLES_MANAGE_SURVEYS, ROLES_SEE_REQUESTER_EMAIL } from "@/lib/roles";
import { buildScopeFilters, type Viewer } from "./metrics";

export const ALL_STATUSES: InviteStatus[] = ["PENDING", "SENT", "VIEWED", "RESPONDED", "EXPIRED", "CANCELLED"];

/**
 * Surveys with their status history, newest first, narrowed to what this viewer may see (same scope as the
 * dashboard). Requester email and the names of staff who acted are shown only to roles that manage surveys.
 */
export async function listSurveys(user: Viewer & Pick<User, "role">, opts: { status?: InviteStatus; limit?: number } = {}) {
  const f = buildScopeFilters(user);
  const rows = await db.surveyInvite.findMany({
    where: { AND: [f.invite, opts.status ? { status: opts.status } : {}] },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.limit ?? 200, 500),
    include: { events: { orderBy: { createdAt: "asc" } } },
  });
  const canManage = ROLES_MANAGE_SURVEYS.includes(user.role);
  const showEmail = ROLES_SEE_REQUESTER_EMAIL.includes(user.role);
  const actorIds = [...new Set(rows.flatMap((r) => r.events.map((e) => e.actorId)).filter((x): x is string => !!x))];
  const actors = canManage && actorIds.length
    ? new Map((await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } })).map((u) => [u.id, u.email]))
    : new Map<string, string>();

  return rows.map((r) => ({
    id: r.id,
    incidentId: r.incidentId,
    supportGroup: r.supportGroup,
    serviceName: r.serviceName,
    requesterEmail: showEmail ? r.requesterEmail : null,
    status: r.status,
    createdAt: r.createdAt,
    sentAt: r.sentAt,
    viewedAt: r.viewedAt,
    expiresAt: r.expiresAt,
    reminderCount: r.reminderCount,
    reopened: r.reopenedFromId !== null,
    replaced: r.replacedById !== null,
    history: r.events.map((e) => ({
      id: e.id, at: e.createdAt, from: e.fromStatus, to: e.toStatus, note: e.note,
      by: e.actorId ? (canManage ? actors.get(e.actorId) ?? "Staff" : "Staff") : "System",
    })),
  }));
}
