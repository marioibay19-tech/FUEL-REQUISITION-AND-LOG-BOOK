import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Not required for `prisma generate` during a build; migrate commands need the real value.
    url: process.env.DATABASE_URL ?? "postgresql://localhost/unset",
  },
});
