import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { setSessionCookie } from "@/lib/auth";
import { safeNextPath } from "@/lib/redirect";

const body = z.object({ email: z.string().email(), password: z.string().min(1), next: z.string().nullish() });
// Compared against when the user does not exist, so response timing stays similar.
const DUMMY = bcrypt.hashSync("not-a-real-password", 10);

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { email, password, next } = parsed.data;
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY);
  if (!user || !user.active || !ok) {
    await audit(user?.id ?? null, "login.failed", email.toLowerCase());
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }
  await audit(user.id, "login.ok");
  const res = NextResponse.json({ redirect: safeNextPath(next) });
  await setSessionCookie(res, user.id);
  return res;
}
