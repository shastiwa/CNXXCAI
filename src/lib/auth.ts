import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Role, User } from "@prisma/client";
import { db } from "./db";
import { env } from "./env";

export const COOKIE = "session";
const key = () => new TextEncoder().encode(env().SESSION_SECRET);

export async function signSession(userId: string) {
  return new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(userId)
    .setIssuedAt().setExpirationTime(`${env().SESSION_TTL_HOURS}h`).sign(key());
}

export async function setSessionCookie(res: NextResponse, userId: string) {
  res.cookies.set(COOKIE, await signSession(userId), {
    httpOnly: true, sameSite: "lax", path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: env().SESSION_TTL_HOURS * 3600,
  });
}

/** Verifies the token AND re-reads the user: deactivation/role changes apply immediately (ADR-006). */
export async function getSession(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    if (!payload.sub) return null;
    const user = await db.user.findUnique({ where: { id: payload.sub } });
    return user?.active ? user : null;
  } catch {
    return null;
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function requireRole(...roles: Role[]): Promise<User> {
  const user = await getSession();
  if (!user) throw new HttpError(401, "Not authenticated");
  if (!roles.includes(user.role)) throw new HttpError(403, "Forbidden");
  return user;
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error(e instanceof Error ? e.message : "unknown error");
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
