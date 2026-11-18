import { env } from "@/lib/env";
import type { BwfConnector, HelixConnector, HelixIncident } from "./types";

/**
 * Field names on the Helix incident form.
 * UNVERIFIED defaults for a standard Helix ITSM (Remedy) install: confirm every one with your Helix admin.
 */
export const HELIX_FIELDS = {
  form: "HPD:Help Desk",
  incidentNumber: "Incident Number",
  status: "Status",
  assignedGroup: "Assigned Group",
  requesterEmail: "Internet E-mail",
  // The link key is the Incident Number itself (user's decision, ADR-012). It is guessable.
  accessKey: "Incident Number",
} as const;

export interface HelixConfig {
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs: number;
}

/** Incident numbers go into a Helix query, so only plain characters are allowed (no quotes). */
const INCIDENT_ID = /^[A-Za-z0-9_-]{3,40}$/;

function checkBaseUrl(raw: string): string {
  const u = new URL(raw);
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !local) throw new Error("HELIX_BASE_URL must use https");
  return u.origin;
}

export function createLiveHelix(cfg: HelixConfig): HelixConnector {
  const base = checkBaseUrl(cfg.baseUrl);
  let jwt: string | null = null;

  async function request(path: string, init: RequestInit): Promise<Response> {
    return fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(cfg.timeoutMs) });
  }

  async function login(): Promise<string> {
    const res = await request("/api/jwt/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: cfg.username, password: cfg.password }),
    });
    if (!res.ok) throw new Error(`Helix login failed (${res.status})`); // never include the body
    return (await res.text()).trim();
  }

  async function lookup(incidentId: string, allowRelogin: boolean): Promise<Response> {
    jwt ??= await login();
    const f = HELIX_FIELDS;
    const q = `'${f.incidentNumber}' = "${incidentId}"`;
    const fields = [...new Set([f.incidentNumber, f.status, f.assignedGroup, f.requesterEmail, f.accessKey])].join(",");
    const res = await request(
      `/api/arsys/v1/entry/${encodeURIComponent(f.form)}?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(`values(${fields})`)}`,
      { headers: { Authorization: `AR-JWT ${jwt}` } },
    );
    if (res.status === 401 && allowRelogin) {
      jwt = null; // token expired: log in once more
      return lookup(incidentId, false);
    }
    return res;
  }

  return {
    async getIncident(incidentId) {
      if (!INCIDENT_ID.test(incidentId)) return null;
      const res = await lookup(incidentId, true);
      if (!res.ok) throw new Error(`Helix returned ${res.status}`);
      const body = (await res.json()) as { entries?: { values?: Record<string, unknown> }[] };
      const v = body.entries?.[0]?.values;
      if (!v) return null;
      const f = HELIX_FIELDS;
      const text = (x: unknown) => (typeof x === "string" ? x : "");
      const incident: HelixIncident = {
        incidentId: text(v[f.incidentNumber]) || incidentId,
        supportGroup: text(v[f.assignedGroup]),
        requesterEmail: text(v[f.requesterEmail]),
        status: text(v[f.status]),
        accessKey: text(v[f.accessKey]) || null,
      };
      return incident;
    },
  };
}

let instance: HelixConnector | undefined;
function fromEnv(): HelixConnector {
  const e = env();
  if (!e.HELIX_BASE_URL || !e.HELIX_USERNAME || !e.HELIX_PASSWORD) {
    throw new Error("HELIX_MODE=live needs HELIX_BASE_URL, HELIX_USERNAME and HELIX_PASSWORD");
  }
  return (instance ??= createLiveHelix({
    baseUrl: e.HELIX_BASE_URL,
    username: e.HELIX_USERNAME,
    password: e.HELIX_PASSWORD,
    timeoutMs: e.HELIX_TIMEOUT_MS,
  }));
}

export const liveHelix: HelixConnector = { getIncident: (id) => fromEnv().getIncident(id) };

// Placeholder for Phase 1 (issue #2): BWF case creation.
export const liveBwf: BwfConnector = {
  async createCase() { throw new Error("Live BWF connector not implemented"); },
};
