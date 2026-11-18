import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { POST } from "@/app/api/auth/login/route";

const EMAIL = "login-test@example.test";
const PASSWORD = "test-only-password-1";

const login = (body: unknown) =>
  POST(new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));

beforeAll(async () => {
  await db.user.deleteMany({ where: { email: EMAIL } });
  await db.user.create({
    data: { email: EMAIL, role: "ADMIN", passwordHash: await bcrypt.hash(PASSWORD, 4) },
  });
});

describe("POST /api/auth/login", () => {
  // The login form sends next: null when the URL has no ?next= parameter.
  it("accepts next: null (what the form sends) and signs in", async () => {
    const res = await login({ email: EMAIL, password: PASSWORD, next: null });
    expect(res.status).toBe(200);
    expect((await res.json()).redirect).toBe("/dashboard");
    expect(res.headers.get("set-cookie")).toContain("session=");
  });

  it("wrong password with next: null is 401, not a validation error", async () => {
    expect((await login({ email: EMAIL, password: "nope", next: null })).status).toBe(401);
  });

  it("keeps a safe next path and drops an unsafe one", async () => {
    expect((await (await login({ email: EMAIL, password: PASSWORD, next: "/cases" })).json()).redirect).toBe("/cases");
    expect((await (await login({ email: EMAIL, password: PASSWORD, next: "//evil.test" })).json()).redirect).toBe("/dashboard");
  });

  it("deactivated users cannot sign in", async () => {
    await db.user.update({ where: { email: EMAIL }, data: { active: false } });
    expect((await login({ email: EMAIL, password: PASSWORD })).status).toBe(401);
    await db.user.update({ where: { email: EMAIL }, data: { active: true } });
  });
});
