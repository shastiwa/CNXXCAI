import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

// Fresh throwaway SQLite DB (prisma/test.db) for every test run.
// We delete the test file instead of using a destructive prisma reset.
export default function setup() {
  for (const f of ["prisma/test.db", "prisma/test.db-journal"]) rmSync(f, { force: true });
  execSync("node node_modules/prisma/build/index.js db push --skip-generate", {
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "pipe",
  });
}
