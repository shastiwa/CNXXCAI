import type { Role } from "@prisma/client";

// One place for "who may do what". Pure data, so the browser menu can use it too.
// The server still checks every request: hiding a menu link is not security.

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "System Administrator",
  EXPERIENCE_TEAM: "Experience Team",
  SERVICE_DELIVERY_MANAGER: "Service Delivery Manager",
  SUPPORT_GROUP: "Support Group Manager",
  SUPPORT_AGENT: "Support Agent",
  CIO: "Read-only Management",
};

export const ALL_ROLES = Object.keys(ROLE_LABELS) as Role[];

/** Dashboard and Responses. What each role sees is narrowed by scopeKind below. */
export const ROLES_VIEW_DATA: Role[] = ALL_ROLES;
/** Cases queue and retry (ADR-005: one central team owns cases). */
export const ROLES_WORK_CASES: Role[] = ["ADMIN", "EXPERIENCE_TEAM"];
/** Cancel, reopen and see who did it in the survey history. Everyone else sees status only. */
export const ROLES_MANAGE_SURVEYS: Role[] = ["ADMIN", "EXPERIENCE_TEAM"];
/** Requester email is personal data. */
export const ROLES_SEE_REQUESTER_EMAIL: Role[] = ["ADMIN", "EXPERIENCE_TEAM"];
/** Screenshots and documents can hold personal data: management and individual agents get none. */
export const ROLES_OPEN_ATTACHMENTS: Role[] = ["ADMIN", "EXPERIENCE_TEAM", "SERVICE_DELIVERY_MANAGER", "SUPPORT_GROUP"];
export const ROLES_ADMIN: Role[] = ["ADMIN"];

export type ScopeKind = "all" | "group" | "agent";

/** How far a role's data reaches. A role missing here sees nothing (see buildScopeFilters). */
export const SCOPE_BY_ROLE: Record<Role, ScopeKind> = {
  ADMIN: "all",
  EXPERIENCE_TEAM: "all",
  SERVICE_DELIVERY_MANAGER: "all",
  CIO: "all",
  SUPPORT_GROUP: "group",
  SUPPORT_AGENT: "agent",
};
