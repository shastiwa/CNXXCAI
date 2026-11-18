import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { PrismaClient, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";

// Local/sandbox seed. Passwords are random and written to .seed-credentials.txt (gitignored), never printed.
const db = new PrismaClient();

const users: { email: string; role: Role; supportGroup?: string }[] = [
  { email: "admin@example.test", role: "ADMIN" },
  { email: "experience@example.test", role: "EXPERIENCE_TEAM" },
  { email: "servicedesk@example.test", role: "SUPPORT_GROUP", supportGroup: "Service Desk" },
  { email: "network@example.test", role: "SUPPORT_GROUP", supportGroup: "Network" },
  { email: "cio@example.test", role: "CIO" },
];

async function main() {
  const lines: string[] = [];
  for (const u of users) {
    const password = randomBytes(9).toString("base64url");
    const passwordHash = await bcrypt.hash(password, 10);
    await db.user.upsert({
      where: { email: u.email },
      update: { passwordHash, role: u.role, supportGroup: u.supportGroup ?? null, active: true },
      create: { ...u, passwordHash },
    });
    lines.push(`${u.email}\t${password}`);
  }
  writeFileSync(".seed-credentials.txt", lines.join("\n") + "\n");
  console.log(`Seeded ${users.length} users. Credentials in .seed-credentials.txt`);
}

main().finally(() => db.$disconnect());
