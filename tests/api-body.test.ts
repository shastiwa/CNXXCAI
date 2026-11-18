import { describe, expect, it } from "vitest";
import { POST as submit } from "@/app/api/survey/submit/route";
import { POST as webhook } from "@/app/api/webhooks/helix/route";

// A browser form post without JavaScript sends form-encoded data, not JSON.
const formPost = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: "loss=5&comments=hello",
  });

describe("non-JSON request bodies", () => {
  it("survey submit returns 400, not 500", async () => {
    expect((await submit(formPost("http://localhost/api/survey/submit"))).status).toBe(400);
  });

  it("webhook returns 400 for a non-JSON body when the signature is valid", async () => {
    const res = await webhook(formPost("http://localhost/api/webhooks/helix", { "x-helix-signature": "test-webhook-secret" }));
    expect(res.status).toBe(400);
  });

  it("webhook still returns 401 for a bad signature", async () => {
    expect((await webhook(formPost("http://localhost/api/webhooks/helix", { "x-helix-signature": "wrong" }))).status).toBe(401);
  });
});
