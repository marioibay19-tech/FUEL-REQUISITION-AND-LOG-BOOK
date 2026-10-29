import { execSync } from "node:child_process";
import "dotenv/config";
import pg from "pg";

// Recreate the dedicated test database schema, then apply the migrations.
// Refuses to run against anything whose database name does not end in "_test".
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL must be set to run the tests (that database is wiped on every run)");
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test") || url === process.env.DATABASE_URL)
    throw new Error(`Refusing to reset "${dbName}": the test database name must end with _test and differ from DATABASE_URL`);
  const client = new pg.Client({ connectionString: url.replace(/\?.*$/, "") });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await client.end();
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
}
