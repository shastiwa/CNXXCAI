import type { Prisma, User } from "@prisma/client";
import { db } from "@/lib/db";
import { SCOPE_BY_ROLE } from "@/lib/roles";

export type Viewer = Pick<User, "role" | "supportGroup"> & { agentName?: string | null };

function scoped(invite: Prisma.SurveyInviteWhereInput) {
  return {
    response: { invite } satisfies Prisma.SurveyResponseWhereInput,
    recoveryCase: { response: { invite } } satisfies Prisma.RecoveryCaseWhereInput,
    invite,
  };
}

/**
 * Group managers see only their group; agents see only surveys where Helix named them as the agent.
 * Fails closed: a role with no rule, or a group or agent user with no group or name, sees nothing.
 */
export function buildScopeFilters(user: Viewer) {
  switch (SCOPE_BY_ROLE[user.role]) {
    case "all":
      return { response: {}, recoveryCase: {}, invite: {} };
    case "group":
      return scoped({ supportGroup: user.supportGroup || "__none__" });
    case "agent":
      return scoped({ assignedAgent: user.agentName || "__none__" });
    default:
      return scoped({ id: "__none__" });
  }
}

export async function getDashboardMetrics(user: Viewer) {
  const f = buildScopeFilters(user);
  // A reopened survey replaces the old one: count the incident once, by its latest survey.
  const latest = { replacedById: null };
  const latestResponse = { invite: latest };
  const [invites, satisfied, unsatisfied, created, failed, pending, loss] = await Promise.all([
    db.surveyInvite.count({ where: { AND: [f.invite, latest] } }),
    db.surveyResponse.count({ where: { AND: [f.response, latestResponse], satisfaction: "SATISFIED" } }),
    db.surveyResponse.count({ where: { AND: [f.response, latestResponse], satisfaction: "UNSATISFIED" } }),
    db.recoveryCase.count({ where: { ...f.recoveryCase, status: "CREATED" } }),
    db.recoveryCase.count({ where: { ...f.recoveryCase, status: "FAILED" } }),
    db.recoveryCase.count({ where: { ...f.recoveryCase, status: "PENDING" } }),
    db.surveyResponse.aggregate({ where: { AND: [f.response, latestResponse] }, _sum: { productivityLossMin: true } }),
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
