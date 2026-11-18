import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/auth";
import { safeEqual } from "@/lib/webhook";
import { bwf, helix } from "@/connectors";
import type { HelixConnector, HelixIncident, HelixIncidentDetails } from "@/connectors/types";
import { getSettings } from "./settings";
import { getActiveReasons } from "./reasons";
import { removeFiles, validateFiles, writeFiles, type UploadedFile } from "./attachments";

export const EXPERIENCE_TEAM = "Experience Management Team";

const optText = (max: number) => z.string().max(max).optional();
export const inviteInput = z.object({
  incidentId: z.string().min(1).max(100),
  supportGroup: z.string().min(1).max(100),
  requesterEmail: z.string().email().max(200),
  requestSummary: optText(300),
  serviceName: optText(200),
  requestType: optText(100),
  category: optText(200),
  priority: optText(50),
  assignedAgent: optText(200),
  resolvedAt: z.coerce.date().optional(),
});

/** Turns Helix details into the optional invite columns (null means "not known"). */
function detailColumns(d: HelixIncidentDetails | null) {
  if (!d) return {};
  return {
    requestSummary: d.summary, serviceName: d.serviceName, requestType: d.requestType,
    category: d.category, priority: d.priority, assignedAgent: d.assignedAgent, resolvedAt: d.resolvedAt,
  };
}

export const submitInput = z.object({
  token: z.string().min(10).max(100),
  satisfaction: z.enum(["SATISFIED", "UNSATISFIED"]),
  productivityLossMin: z.number().int().min(0).max(100000).optional(),
  dissatisfactionReason: z.string().max(500).optional(),
  callbackPreference: z.enum(["NONE", "EMAIL", "PHONE"]).default("NONE"),
  comments: z.string().max(2000).optional(),
});

export async function createInvite(input: z.infer<typeof inviteInput>) {
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + (await getSettings()).expiryDays * 86400_000);
  const invite = await db.surveyInvite.create({ data: { ...input, token, expiresAt } });
  const base = `${env().APP_BASE_URL}/survey/${invite.token}`;
  return {
    token: invite.token,
    expiresAt,
    links: { satisfied: `${base}?r=SATISFIED`, unsatisfied: `${base}?r=UNSATISFIED` },
  };
}

export const incidentLinkInput = z.object({
  incident: z.string().regex(/^[A-Za-z0-9_-]{3,40}$/),
  key: z.string().regex(/^[A-Za-z0-9_.-]{6,200}$/),
});

/** Same text for every "not valid" reason, so a link cannot be used to probe which incidents exist. */
const NOT_AVAILABLE = "This survey link is not valid or not available.";
/** Shown only when the key matched but the incident is not resolved yet (user's request). */
export const NOT_RESOLVED = "This incident is not resolved yet, so the survey is not available. Please use the link after it is resolved.";

/**
 * Helix sends the end user a link that holds the incident number and an unguessable key.
 * On click we ask Helix (read-only) whether the incident exists, the key matches, it is resolved,
 * and it has a requester. Only then do we create the survey (one per incident).
 */
export async function openSurveyForIncident(raw: unknown, connector: HelixConnector = helix()) {
  const parsed = incidentLinkInput.safeParse(raw);
  if (!parsed.success) throw new HttpError(404, NOT_AVAILABLE);
  const { incident, key } = parsed.data;

  let found: HelixIncident | null;
  try {
    found = await connector.getIncident(incident);
  } catch (e) {
    // Server log only. Connector errors carry a status code or network reason, never a response body or credentials.
    console.error("[helix] lookup failed:", e instanceof Error ? `${e.message}${e.cause instanceof Error ? ` (${e.cause.message})` : ""}` : "unknown");
    throw new HttpError(503, "The survey is temporarily unavailable. Please try again later.");
  }

  const resolved = env().HELIX_RESOLVED_STATUSES.split(",").map((s) => s.trim().toLowerCase());
  const keyOk = found !== null && found.accessKey !== null && safeEqual(found.accessKey, key);
  if (!found || !keyOk) throw new HttpError(404, NOT_AVAILABLE);
  // Only after the key matches, so a wrong key learns nothing. Status text itself is never shown.
  if (!resolved.includes(found.status.trim().toLowerCase())) throw new HttpError(409, NOT_RESOLVED);
  if (!z.string().email().safeParse(found.requesterEmail).success) throw new HttpError(404, NOT_AVAILABLE);

  const existing = await db.incidentLink.findUnique({ where: { incidentId: incident } });
  if (existing) return openExisting(existing.inviteId);

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + (await getSettings()).expiryDays * 86400_000);
  // Request details are best effort: if Helix cannot give them, the survey still opens.
  const details = await connector.getIncidentDetails?.(incident).catch(() => null) ?? null;
  try {
    await db.$transaction(async (tx) => {
      // Group and email come from Helix, never from the link.
      const invite = await tx.surveyInvite.create({
        data: {
          token, expiresAt, incidentId: incident,
          supportGroup: found.supportGroup || "Unassigned",
          requesterEmail: found.requesterEmail,
          ...detailColumns(details),
        },
      });
      await tx.incidentLink.create({ data: { incidentId: incident, inviteId: invite.id } });
    });
    return { token };
  } catch (e) {
    // Two clicks at once: the other one won, use its survey.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const link = await db.incidentLink.findUnique({ where: { incidentId: incident } });
      if (link) return openExisting(link.inviteId);
    }
    throw e;
  }
}

async function openExisting(inviteId: string) {
  const invite = await db.surveyInvite.findUnique({ where: { id: inviteId } });
  if (!invite) throw new HttpError(404, NOT_AVAILABLE);
  await loadOpenInvite(invite.token); // throws 409 (done) or 410 (expired)
  return { token: invite.token };
}

/** Returns a usable invite or throws 404 / 409 / 410. Marks overdue invites EXPIRED. */
export async function loadOpenInvite(token: string) {
  const invite = await db.surveyInvite.findUnique({ where: { token } });
  if (!invite) throw new HttpError(404, "Survey not found");
  if (invite.status === "RESPONDED") throw new HttpError(409, "Survey already completed");
  if (invite.status === "EXPIRED" || invite.expiresAt.getTime() < Date.now()) {
    if (invite.status !== "EXPIRED") {
      await db.surveyInvite.update({ where: { id: invite.id }, data: { status: "EXPIRED" } });
    }
    throw new HttpError(410, "Survey link has expired");
  }
  return invite;
}

/**
 * What the (unauthenticated) survey page may show. Never the requester email or the agent name.
 * The summary is shown only when the admin setting allows it, because it is free text from Helix.
 */
export async function getSurveyContext(token: string) {
  const invite = await loadOpenInvite(token);
  const [settings, reasons] = await Promise.all([getSettings(), getActiveReasons()]);
  return {
    incidentId: invite.incidentId,
    expiresAt: invite.expiresAt,
    supportGroup: invite.supportGroup,
    serviceName: invite.serviceName,
    resolvedAt: invite.resolvedAt,
    requestSummary: settings.showRequestSummary ? invite.requestSummary : null,
    reasons,
    uploads: {
      maxFiles: settings.maxFiles,
      maxFileMb: settings.maxFileMb,
      allowedExtensions: settings.allowedExtensions,
    },
  };
}

/**
 * ADR-004: persist the response (and a PENDING case) first; BWF failure never fails the submit.
 * Files are checked before anything is written, written before the database save, and removed
 * again if the save fails (for example a second submit at the same moment).
 */
export async function submitResponse(raw: unknown, files: UploadedFile[] = []) {
  const input = submitInput.parse(raw);
  const invite = await loadOpenInvite(input.token);

  if (files.length > 0 && input.satisfaction !== "UNSATISFIED") {
    throw new HttpError(400, "Attachments can only be added to an Unsatisfied response.");
  }
  const reason = input.satisfaction === "UNSATISFIED" ? input.dissatisfactionReason : undefined;
  if (reason !== undefined && !(await getActiveReasons()).includes(reason)) {
    throw new HttpError(400, "Please choose one of the listed reasons.");
  }
  const stored = validateFiles(files, await getSettings());

  let result: { responseId: string; caseId: string | null };
  await writeFiles(files, stored);
  try {
    result = await db.$transaction(async (tx) => {
      const response = await tx.surveyResponse.create({
        data: {
          inviteId: invite.id,
          satisfaction: input.satisfaction,
          productivityLossMin: input.productivityLossMin,
          dissatisfactionReason: reason,
          callbackPreference: input.callbackPreference,
          comments: input.comments,
          attachments: { create: stored },
        },
      });
      await tx.surveyInvite.update({ where: { id: invite.id }, data: { status: "RESPONDED" } });
      let caseId: string | null = null;
      if (input.satisfaction === "UNSATISFIED") {
        const rc = await tx.recoveryCase.create({
          data: { responseId: response.id, assignedTeam: EXPERIENCE_TEAM },
        });
        caseId = rc.id;
      }
      return { responseId: response.id, caseId };
    });
  } catch (e) {
    await removeFiles(stored.map((s) => s.storageKey)); // nothing saved, so no orphan files
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new HttpError(409, "Survey already completed");
    }
    throw e;
  }

  if (result.caseId) await pushCaseToBwf(result.caseId); // never throws on connector errors
  return { responseId: result.responseId };
}

/** Attempts BWF creation; records CREATED or FAILED. Never throws on connector errors. */
export async function pushCaseToBwf(caseId: string) {
  const rc = await db.recoveryCase.findUnique({
    where: { id: caseId },
    include: { response: { include: { invite: true } } },
  });
  if (!rc) throw new HttpError(404, "Case not found");
  if (rc.status === "CREATED") return rc;
  const { invite, dissatisfactionReason } = rc.response;
  try {
    const res = await bwf().createCase({
      incidentId: invite.incidentId,
      summary: `Unsatisfied user, incident ${invite.incidentId}: ${dissatisfactionReason ?? "no reason given"}`,
      assignedTeam: rc.assignedTeam,
    });
    return await db.recoveryCase.update({
      where: { id: caseId },
      data: {
        status: "CREATED",
        bwfCaseId: res.caseId,
        bwfCaseNumber: res.caseNumber,
        attempts: { increment: 1 },
        lastError: null,
      },
    });
  } catch (e) {
    const msg = (e instanceof Error ? e.message : "unknown error").slice(0, 300);
    return db.recoveryCase.update({
      where: { id: caseId },
      data: { status: "FAILED", attempts: { increment: 1 }, lastError: msg },
    });
  }
}
