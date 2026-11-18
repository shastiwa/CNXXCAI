import type { BwfConnector, CreateCaseInput, HelixConnector } from "./types";

/**
 * Mock Helix. Behaviour is driven by the incident id so every path can be demoed:
 *  - contains "MISSING": incident does not exist
 *  - contains "OPEN":    incident is not resolved yet
 *  - contains "NOREQ":   incident has no requester email
 *  - contains "HELIXDOWN": Helix is unreachable
 *  - otherwise: resolved, and the access key is `key-<incidentId>`
 */
export const mockHelix: HelixConnector = {
  async getIncident(incidentId) {
    if (incidentId.includes("HELIXDOWN")) throw new Error("Helix unreachable (mock)");
    if (incidentId.includes("MISSING")) return null;
    return {
      incidentId,
      supportGroup: "Service Desk",
      requesterEmail: incidentId.includes("NOREQ") ? "" : `${incidentId.toLowerCase()}@example.test`,
      status: incidentId.includes("OPEN") ? "In Progress" : "Resolved",
      accessKey: `key-${incidentId}`,
    };
  },
};

let counter = 1000;
/** Mock BWF. An incident id containing "FAIL" simulates an outage (for tests and demos). */
export const mockBwf: BwfConnector = {
  async createCase(input: CreateCaseInput) {
    if (input.incidentId.includes("FAIL")) throw new Error("BWF unavailable (mock)");
    counter += 1;
    return { caseId: `mock-${counter}`, caseNumber: `EXP-${counter}` };
  },
};
