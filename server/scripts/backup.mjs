// Database and upload backup: pg_dump (custom format) + a tar of the upload folder.
// Usage: npm run backup --workspace server   (BACKUP_DIR defaults to ./backups)
// Requires the PostgreSQL client tools (pg_dump) on the PATH.
import "dotenv/config";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const dir = path.resolve(process.env.BACKUP_DIR ?? "./backups");
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dbFile = path.join(dir, `fueltrack-db-${stamp}.dump`);
execFileSync("pg_dump", ["--format=custom", "--no-owner", "--file", dbFile, url.replace(/\?schema=\w+$/, "")], { stdio: "inherit" });
console.log(`Database backup written to ${dbFile}`);
const uploads = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");
if (fs.existsSync(uploads)) {
  const tarFile = path.join(dir, `fueltrack-uploads-${stamp}.tar.gz`);
  execFileSync("tar", ["-czf", tarFile, "-C", path.dirname(uploads), path.basename(uploads)], { stdio: "inherit" });
  console.log(`Uploaded documents archived to ${tarFile}`);
}
// Keep the newest 30 backups of each kind.
for (const prefix of ["fueltrack-db-", "fueltrack-uploads-"]) {
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix)).sort().reverse();
  for (const old of files.slice(30)) fs.rmSync(path.join(dir, old));
}
