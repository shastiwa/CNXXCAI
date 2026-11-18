import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLiveHelix, HELIX_FIELDS as F } from "@/connectors/live";

// A fake Helix REST server. Test credentials only.
const USER = "svc-test";
const PASS = "test-only-pass";
let server: Server;
let base: string;
let log: { method: string; url: string; auth?: string; body: string }[];
let issued = 0;
let mode: "ok" | "expire-once" | "500" | "login-fail" = "ok";

const read = (req: IncomingMessage) =>
  new Promise<string>((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await read(req);
    log.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization, body });
    if (req.url === "/api/jwt/login") {
      const p = new URLSearchParams(body);
      if (mode === "login-fail" || p.get("username") !== USER || p.get("password") !== PASS) { res.statusCode = 401; return res.end("bad creds: secret-detail"); }
      issued += 1;
      return res.end(`jwt-${issued}`);
    }
    const expired = mode === "expire-once" && req.headers.authorization === "AR-JWT jwt-1";
    if (mode === "500") { res.statusCode = 500; return res.end("internal: secret-detail"); }
    if (expired || !req.headers.authorization?.startsWith("AR-JWT jwt-")) { res.statusCode = 401; return res.end(); }
    const q = decodeURIComponent(new URL(req.url ?? "", base).searchParams.get("q") ?? "");
    res.setHeader("content-type", "application/json");
    if (q.includes("INC000123")) {
      return res.end(JSON.stringify({ entries: [{ values: {
        [F.incidentNumber]: "INC000123", [F.status]: "Resolved", [F.assignedGroup]: "Network",
        [F.requesterEmail]: "req@example.test",
      } }] }));
    }
    res.end(JSON.stringify({ entries: [] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => { log = []; issued = 0; mode = "ok"; });

const connector = (user = USER, pass = PASS) => createLiveHelix({ baseUrl: base, username: user, password: pass, timeoutMs: 3000 });

describe("live Helix connector (against a fake Helix)", () => {
  it("logs in, then reads the incident with the AR-JWT token", async () => {
    const inc = await connector().getIncident("INC000123");
    expect(inc).toEqual({ incidentId: "INC000123", supportGroup: "Network", requesterEmail: "req@example.test", status: "Resolved", accessKey: "INC000123" }); // key = Incident Number (ADR-012)
    expect(log[0].url).toBe("/api/jwt/login");
    expect(log[1].auth).toBe("AR-JWT jwt-1");
    expect(log[1].method).toBe("GET"); // read-only
    expect(decodeURIComponent(log[1].url)).toContain(`'${F.incidentNumber}' = "INC000123"`);
  });

  it("returns null when the incident does not exist", async () => {
    expect(await connector().getIncident("INC999999")).toBeNull();
  });

  it("reuses the token for later lookups", async () => {
    const c = connector();
    await c.getIncident("INC000123");
    await c.getIncident("INC000123");
    expect(log.filter((l) => l.url === "/api/jwt/login")).toHaveLength(1);
  });

  it("logs in again once when the token has expired", async () => {
    mode = "expire-once";
    const inc = await connector().getIncident("INC000123");
    expect(inc?.status).toBe("Resolved");
    expect(log.filter((l) => l.url === "/api/jwt/login")).toHaveLength(2);
  });

  it("never sends an incident number with query characters to Helix", async () => {
    for (const bad of ['INC1" OR "1"="1', "INC1' OR 1=1", "a", "x".repeat(60), "INC 1"]) {
      expect(await connector().getIncident(bad)).toBeNull();
    }
    expect(log).toHaveLength(0);
  });

  it("errors do not leak the Helix response body", async () => {
    const wrong = await connector(USER, "wrong").getIncident("INC000123").catch((e) => e as Error);
    expect((wrong as Error).message).toBe("Helix login failed (401)");
    mode = "500";
    const down = await connector().getIncident("INC000123").catch((e) => e as Error);
    expect((down as Error).message).toBe("Helix returned 500");
    expect(`${(wrong as Error).message}${(down as Error).message}`).not.toContain("secret-detail");
  });

  it("refuses to send credentials over plain http to a non-local host", () => {
    expect(() => createLiveHelix({ baseUrl: "http://helix.example.com", username: "u", password: "p", timeoutMs: 1000 })).toThrow(/https/);
  });
});
