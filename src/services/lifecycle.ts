import { randomBytes } from "node:crypto";
import { Prisma, type InviteStatus, type User } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { HttpError } from "@/lib/auth";
import { reminderSender } from "@/connectors/reminder";
import { getSettings } from "./settings";

type Client = Pick<Prisma.TransactionClient, "surveyInvite" | "surveyStatusEvent">;

/** Allowed moves. RESPONDED is final. EXPIRED and CANCELLED leave only through reopenInvite. */
export const TRANSITIONS: Record<InviteStatus, InviteStatus[]> = {
  PENDING: ["SENT", "VIEWED", "RESPONDED", "EXPIRED", "CANCELLED"],
  SENT: ["VIEWED", "RESPONDED", "EXPIRED", "CANCELLED"],
  VIEWED: ["RESPONDED", "EXPIRED", "CANCELLED"],
  RESPONDED: [],
  EXPIRED: [],
  CANCELLED: [],
};
export const OPEN_STATUSES: InviteStatus[] = ["PENDING", "SENT", "VIEWED"];

export const reasonInput = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

/**
 * Moves a survey to a new status and writes the history row. Returns false (and writes nothing) when the move
 * is not allowed from where the survey is now, or when another request moved it first. The update only matches
 * the status we read, so two requests at once cannot both win.
 */
export async function moveStatus(
  c: Client, inviteId: string, to: InviteStatus,
  opts: { note?: string; actorId?: string | null; data?: Prisma.SurveyInviteUpdateManyMutationInput } = {},
): Promise<boolean> {
  const cur = await c.surveyInvite.findUnique({ where: { id: inviteId }, select: { status: true } });
  if (!cur || !TRANSITIONS[cur.status].includes(to)) return false;
  const res = await c.surveyInvite.updateMany({ where: { id: inviteId, status: cur.status }, data: { ...opts.data, status: to } });
  if (res.count !== 1) return false;
  await c.surveyStatusEvent.create({
    data: { inviteId, fromStatus: cur.status, toStatus: to, note: opts.note, actorId: opts.actorId ?? null },
  });
  return true;
}

/** Writes the first history row for a survey that was just created. */
export function recordCreated(c: Client, inviteId: string, status: InviteStatus, note: string) {
  return c.surveyStatusEvent.create({ data: { inviteId, fromStatus: null, toStatus: status, note } });
}

export const markSent = (inviteId: string, note: string) =>
  moveStatus(db, inviteId, "SENT", { note, data: { sentAt: new Date() } });
export const markViewed = (inviteId: string) =>
  moveStatus(db, inviteId, "VIEWED", { note: "Survey page opened", data: { viewedAt: new Date() } });
export const expireInvite = (inviteId: string, note = "Link expired") => moveStatus(db, inviteId, "EXPIRED", { note });

async function getInvite(id: string) {
  const invite = await db.surveyInvite.findUnique({ where: { id } });
  if (!invite) throw new HttpError(404, "Survey not found");
  return invite;
}

export async function cancelInvite(actor: Pick<User, "id">, inviteId: string, raw: unknown) {
  const { reason } = reasonInput.parse(raw);
  await getInvite(inviteId);
  const ok = await moveStatus(db, inviteId, "CANCELLED", { note: reason, actorId: actor.id });
  if (!ok) throw new HttpError(409, "Only a survey that is still open can be cancelled.");
  await audit(actor.id, "survey.cancel", inviteId, reason);
}

/** How many times this incident's survey has already been reopened (walks back along reopenedFromId). */
async function reopenCount(invite: { reopenedFromId: string | null }) {
  let n = 0;
  let from = invite.reopenedFromId;
  while (from && n < 20) {
    n++;
    from = (await db.surveyInvite.findUnique({ where: { id: from }, select: { reopenedFromId: true } }))?.reopenedFromId ?? null;
  }
  return n;
}

/**
 * Controlled resubmission. Needs a reason, is audited, and is limited by the admin setting maxReopens.
 * - Answered survey: a NEW survey is made; the old one keeps its response untouched. The Helix link of the
 *   incident then opens the new survey.
 * - Expired or cancelled survey: the same survey is reopened with a fresh expiry.
 */
export async function reopenInvite(actor: Pick<User, "id">, inviteId: string, raw: unknown) {
  const { reason } = reasonInput.parse(raw);
  const invite = await getInvite(inviteId);
  const settings = await getSettings();
  const expiresAt = new Date(Date.now() + settings.expiryDays * 86400_000);

  if (OPEN_STATUSES.includes(invite.status)) throw new HttpError(409, "This survey is still open.");
  if (invite.replacedById) throw new HttpError(409, "This survey was already reopened.");

  if (invite.status !== "RESPONDED") {
    const to: InviteStatus = invite.sentAt ? "SENT" : "PENDING";
    const res = await db.$transaction(async (tx) => {
      const r = await tx.surveyInvite.updateMany({
        where: { id: invite.id, status: invite.status },
        data: { status: to, expiresAt, reminderCount: 0, lastReminderAt: null },
      });
      if (r.count !== 1) return false;
      await tx.surveyStatusEvent.create({
        data: { inviteId: invite.id, fromStatus: invite.status, toStatus: to, note: `Reopened: ${reason}`, actorId: actor.id },
      });
      return true;
    });
    if (!res) throw new HttpError(409, "The survey changed while you were reopening it. Refresh and try again.");
    await audit(actor.id, "survey.reopen", inviteId, reason);
    return { token: invite.token, link: surveyLink(invite.token), replacedBy: null as string | null };
  }

  if ((await reopenCount(invite)) >= settings.maxReopens) {
    throw new HttpError(409, `This survey can be reopened at most ${settings.maxReopens} time(s). An admin can raise the limit in settings.`);
  }
  const token = randomBytes(24).toString("base64url");
  const created = await db.$transaction(async (tx) => {
    const claimed = await tx.surveyInvite.updateMany({ where: { id: invite.id, replacedById: null }, data: { replacedById: "pending" } });
    if (claimed.count !== 1) throw new HttpError(409, "This survey was already reopened.");
    const next = await tx.surveyInvite.create({
      data: {
        token, expiresAt, reopenedFromId: invite.id,
        incidentId: invite.incidentId, supportGroup: invite.supportGroup, requesterEmail: invite.requesterEmail,
        requestSummary: invite.requestSummary, serviceName: invite.serviceName, requestType: invite.requestType,
        category: invite.category, priority: invite.priority, assignedAgent: invite.assignedAgent, resolvedAt: invite.resolvedAt,
      },
    });
    await tx.surveyInvite.update({ where: { id: invite.id }, data: { replacedById: next.id } });
    await tx.surveyStatusEvent.create({
      data: { inviteId: invite.id, fromStatus: "RESPONDED", toStatus: "RESPONDED", note: `Reopened for a new answer: ${reason}`, actorId: actor.id },
    });
    await recordCreated(tx, next.id, "PENDING", `Reopened from an answered survey: ${reason}`);
    // The Helix link of this incident now opens the new survey.
    await tx.incidentLink.updateMany({ where: { inviteId: invite.id }, data: { inviteId: next.id } });
    return next;
  });
  await audit(actor.id, "survey.reopen", inviteId, reason);
  return { token, link: surveyLink(token), replacedBy: created.id };
}

const surveyLink = (token: string) => `${env().APP_BASE_URL}/survey/${token}`;

export interface JobResult {
  expired: number;
  reminders: { enabled: boolean; due: number; sent: number; failed: number; note: string | null };
}

/**
 * Safe to run as often as you like (for example every hour). Expires overdue surveys, then sends reminders.
 * Reminders go out only when an admin turned them on AND a delivery method exists (REMINDER_MODE). With no
 * delivery method nothing is sent and nothing is counted: the result says how many are due.
 */
export async function runLifecycleJobs(now = new Date()): Promise<JobResult> {
  const overdue = await db.surveyInvite.findMany({
    where: { status: { in: OPEN_STATUSES }, expiresAt: { lt: now } }, select: { id: true }, take: 1000,
  });
  let expired = 0;
  for (const o of overdue) if (await expireInvite(o.id, "Link expired (scheduled job)")) expired++;

  const settings = await getSettings();
  const reminders: JobResult["reminders"] = { enabled: settings.remindersEnabled, due: 0, sent: 0, failed: 0, note: null };
  if (!settings.remindersEnabled || settings.maxReminders === 0) {
    reminders.note = "Reminders are turned off in settings.";
    return { expired, reminders };
  }

  const waitMs = settings.reminderAfterDays * 86400_000;
  const candidates = await db.surveyInvite.findMany({
    where: {
      status: { in: ["SENT", "VIEWED"] }, expiresAt: { gt: now }, replacedById: null,
      reminderCount: { lt: settings.maxReminders },
    },
    take: 1000,
  });
  const due = candidates.filter((c) => now.getTime() - (c.lastReminderAt ?? c.viewedAt ?? c.sentAt ?? c.createdAt).getTime() >= waitMs);
  reminders.due = due.length;

  const sender = reminderSender();
  if (!sender) {
    reminders.note = "Nothing sent: no reminder delivery method is configured (REMINDER_MODE).";
    return { expired, reminders };
  }
  for (const inv of due) {
    // Claim first: a second job run at the same moment finds the count already moved and skips this survey.
    const claim = await db.surveyInvite.updateMany({
      where: { id: inv.id, reminderCount: inv.reminderCount },
      data: { reminderCount: { increment: 1 }, lastReminderAt: now },
    });
    if (claim.count !== 1) continue;
    const number = inv.reminderCount + 1;
    try {
      await sender.send({ incidentId: inv.incidentId, to: inv.requesterEmail, link: surveyLink(inv.token), number });
      await db.surveyStatusEvent.create({ data: { inviteId: inv.id, fromStatus: inv.status, toStatus: inv.status, note: `Reminder ${number} sent` } });
      reminders.sent++;
    } catch (e) {
      // Not delivered, so give the slot back and try again at the next run.
      await db.surveyInvite.updateMany({ where: { id: inv.id }, data: { reminderCount: inv.reminderCount, lastReminderAt: inv.lastReminderAt } });
      const why = (e instanceof Error ? e.message : "unknown error").slice(0, 200);
      await db.surveyStatusEvent.create({ data: { inviteId: inv.id, fromStatus: inv.status, toStatus: inv.status, note: `Reminder ${number} failed: ${why}` } });
      reminders.failed++;
    }
  }
  return { expired, reminders };
}
