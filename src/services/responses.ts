import type { Satisfaction, User } from "@prisma/client";
import { db } from "@/lib/db";
import { ROLES_OPEN_ATTACHMENTS, ROLES_SEE_REQUESTER_EMAIL } from "@/lib/roles";
import { buildScopeFilters, type Viewer } from "./metrics";

/** Requester email is personal data: only roles that work cases need it. */
export function canSeeRequesterEmail(user: Pick<User, "role">) {
  return ROLES_SEE_REQUESTER_EMAIL.includes(user.role);
}

/** Screenshots and documents can hold personal data: management and individual agents get counts, not files. */
export function canOpenAttachments(user: Pick<User, "role">) {
  return ROLES_OPEN_ATTACHMENTS.includes(user.role);
}

/** Returns the attachment only if this viewer may open it (group managers: own group only). */
export async function findAttachmentForViewer(user: Viewer, id: string) {
  if (!canOpenAttachments(user)) return null;
  const f = buildScopeFilters(user);
  return db.surveyAttachment.findFirst({ where: { id, response: f.response } });
}

/** Newest first. SUPPORT_GROUP users only get their own group's responses. */
export async function listResponses(user: Viewer, opts: { satisfaction?: Satisfaction; limit?: number } = {}) {
  const f = buildScopeFilters(user);
  const rows = await db.surveyResponse.findMany({
    where: { ...f.response, ...(opts.satisfaction ? { satisfaction: opts.satisfaction } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.limit ?? 200, 500),
    include: {
      invite: true,
      recoveryCase: { select: { status: true, bwfCaseNumber: true } },
      attachments: { select: { id: true, fileName: true, sizeBytes: true } },
    },
  });
  const showEmail = canSeeRequesterEmail(user);
  const showFiles = canOpenAttachments(user);
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
    attachmentCount: r.attachments.length,
    attachments: showFiles ? r.attachments : [],
    serviceName: r.invite.serviceName,
  }));
}
