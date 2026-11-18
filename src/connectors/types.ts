export interface HelixIncident {
  incidentId: string;
  supportGroup: string;
  /** Empty when the incident has no usable requester. */
  requesterEmail: string;
  /** Helix status text, for example "Resolved". */
  status: string;
  /** Unguessable value Helix puts in the survey link (for example the incident's instance ID). */
  accessKey: string | null;
}

export interface CreateCaseInput {
  incidentId: string;
  summary: string;
  assignedTeam: string;
}

export interface CreateCaseResult {
  caseId: string;
  caseNumber: string;
}

export interface HelixConnector {
  /** Read-only lookup. Returns null when the incident does not exist. Throws when Helix is unreachable. */
  getIncident(incidentId: string): Promise<HelixIncident | null>;
}

export interface BwfConnector {
  createCase(input: CreateCaseInput): Promise<CreateCaseResult>;
}
