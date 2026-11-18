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

/** Extra request information shown on the survey page and used for analytics. Every field is optional. */
export interface HelixIncidentDetails {
  summary: string | null;
  serviceName: string | null;
  requestType: string | null;
  category: string | null;
  priority: string | null;
  assignedAgent: string | null;
  resolvedAt: Date | null;
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
  /**
   * Best effort and read-only. Returns null when the details cannot be read. Never throws, because
   * the survey must still open when these (not yet verified) fields are missing in Helix.
   */
  getIncidentDetails?(incidentId: string): Promise<HelixIncidentDetails | null>;
}

export interface BwfConnector {
  createCase(input: CreateCaseInput): Promise<CreateCaseResult>;
}
