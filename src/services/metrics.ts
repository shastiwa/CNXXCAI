import type { Prisma, User } from "@prisma/client";
import { db } from "@/lib/db";

/** SUPPORT_GROUP users only ever see their own group's numbers. */
export function buildScopeFilters(user: Pick<User, "role" | "supportGroup">) {
  if (user.role === "SUPPORT_GROUP") {
    const group = user.supportGroup ?? "__none__";
    return {
      response: { invite: { supportGroup: group } } satisfies Prisma.SurveyResponseWhereInput,
      recoveryCase: { response: { invite: { supportGroup: group } } } satisfies Prisma.RecoveryCaseWhereInput,
      invite: { supportGroup: group } satisfies Prisma.SurveyInviteWhereInput,
    };
  }
  return { response: {}, recoveryCase: {}, invite: {} };
}

export async function getDashboardMetrics(user: Pick<User, "role" | "supportGroup">) {
  const f = buildScopeFilters(user);
  const [invites, satisfied, unsatisfied, created, failed, pending, loss] = await Promise.all([
    db.surveyInvite.count({ where: f.invite }),
    db.surveyResponse.count({ where: { ...f.response, satisfaction: "SATISFIED" } }),
    db.surveyResponse.count({ where: { ...f.response, satisfaction: "UNSATISFIED" } }),
    db.recoveryCase.count({ where: { ...f.recoveryCase, status: "CREATED" } }),
    db.recoveryCase.count({ where: { ...f.recoveryCase, status: "FAILED" } }),
    db.recoveryCase.count({ where: { ...f.recoveryCase, status: "PENDING" } }),
    db.surveyResponse.aggregate({ where: f.response, _sum: { productivityLossMin: true } }),
  ]);
  const responses = satisfied + unsatisfied;
  return {
    invites,
    responses,
    satisfied,
    unsatisfied,
    responseRatePct: invites ? Math.round((responses / invites) * 100) : 0,
    satisfactionPct: responses ? Math.round((satisfied / responses) * 100) : 0,
    productivityLossMin: loss._sum.productivityLossMin ?? 0,
    cases: { created, failed, pending },
  };
}
