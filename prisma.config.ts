
import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

config({ path: ".env.local" });
config();

const prismaCliDatabaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (process.env.VERCEL && !process.env.DIRECT_URL) {
  throw new Error(
    "DIRECT_URL is required on Vercel for Prisma migrations. Use the non-pooled Neon connection URL.",
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "classic",
  datasource: {
    // Avoid running migrations through pooled URLs; advisory locks require a direct connection.
    url: prismaCliDatabaseUrl ?? env("DATABASE_URL"),
  },
});
