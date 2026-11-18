import type { Satisfaction, User } from "@prisma/client";
import { db } from "@/lib/db";
import { buildScopeFilters } from "./metrics";

type Viewer = Pick<User, "role" | "supportGroup">;

/** Requester email is personal data: only roles that work cases need it. */
export function canSeeRequesterEmail(user: Pick<User, "role">) {
  return user.role === "ADMIN" || user.role === "EXPERIENCE_TEAM";
}

/** Newest first. SUPPORT_GROUP users only get their own group's responses. */
export async function listResponses(user: Viewer, opts: { satisfaction?: Satisfaction; limit?: number } = {}) {
  const f = buildScopeFilters(user);
  const rows = await db.surveyResponse.findMany({
    where: { ...f.response, ...(opts.satisfaction ? { satisfaction: opts.satisfaction } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.limit ?? 200, 500),
    include: { invite: true, recoveryCase: { select: { status: true, bwfCaseNumber: true } } },
  });
  const showEmail = canSeeRequesterEmail(user);
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    incidentId: r.invite.incidentId,
    supportGroup: r.invite.supportGroup,
    requesterEmail: showEmail ? r.invite.requesterEmail : null,
    satisfaction: r.satisfaction,
    productivityLossMin: r.productivityLossMin,
    dissatisfactionReason: r.dissatisfactionReason,
    callbackPreference: r.callbackPreference,
    comments: r.comments,
    caseStatus: r.recoveryCase?.status ?? null,
    caseNumber: r.recoveryCase?.bwfCaseNumber ?? null,
  }));
}
