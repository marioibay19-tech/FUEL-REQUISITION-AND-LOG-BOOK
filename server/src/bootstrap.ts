// Run on every production start (after `prisma migrate deploy`): loads the
// reference data and creates the first administrator if it does not exist yet.
import { prisma } from "./db.js";
import { seedBase } from "./lib/seed-base.js";

seedBase()
  .then(() => console.log("Reference data is in place."))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
