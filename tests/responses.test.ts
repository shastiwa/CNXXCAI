import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createInvite, submitResponse } from "@/services/survey";
import { listResponses } from "@/services/responses";

async function answer(incidentId: string, supportGroup: string, satisfaction: "SATISFIED" | "UNSATISFIED", comments: string) {
  const i = await createInvite({ incidentId, supportGroup, requesterEmail: `${incidentId.toLowerCase()}@example.test` });
  await submitResponse({ token: i.token, satisfaction, comments, dissatisfactionReason: satisfaction === "UNSATISFIED" ? "Resolution took too long" : undefined });
}

beforeEach(async () => {
  await db.recoveryCase.deleteMany();
  await db.surveyResponse.deleteMany();
  await db.surveyInvite.deleteMany();
  await answer("R1", "Service Desk", "SATISFIED", "great work");
  await answer("R2", "Network", "UNSATISFIED", "still slow");
});

describe("listResponses", () => {
  it("admin sees every response with comments and requester email", async () => {
    const rows = await listResponses({ role: "ADMIN", supportGroup: null });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.comments).sort()).toEqual(["great work", "still slow"]);
    expect(rows.every((r) => r.requesterEmail?.endsWith("@example.test"))).toBe(true);
  });

  it("a support group sees only its own responses and never the requester email", async () => {
    const rows = await listResponses({ role: "SUPPORT_GROUP", supportGroup: "Network" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ incidentId: "R2", comments: "still slow", requesterEmail: null });
  });

  it("a support group with no group sees nothing", async () => {
    expect(await listResponses({ role: "SUPPORT_GROUP", supportGroup: null })).toHaveLength(0);
  });

  it("CIO sees all responses but not the requester email", async () => {
    const rows = await listResponses({ role: "CIO", supportGroup: null });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.requesterEmail === null)).toBe(true);
  });

  it("filters by satisfaction and shows the case for unsatisfied answers", async () => {
    const rows = await listResponses({ role: "ADMIN", supportGroup: null }, { satisfaction: "UNSATISFIED" });
    expect(rows).toHaveLength(1);
    expect(rows[0].caseNumber).toMatch(/^EXP-/);
  });
});
