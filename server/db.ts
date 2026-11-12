import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import "dotenv/config";
import { PrismaClient } from "./generated/prisma/client";

// Prisma 7 talks to SQLite through a driver adapter. For PostgreSQL, use @prisma/adapter-pg instead.
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });

export const prisma = new PrismaClient({ adapter });

/** Unique-constraint violation, e.g. two sign-ups with the same email. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}
