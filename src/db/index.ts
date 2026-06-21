import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import * as schema from "./schema";

const connectionString =
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL;
if (!connectionString) throw new Error("Missing database connection string (POSTGRES_URL or DATABASE_URL)");

const globalForDb = globalThis as typeof globalThis & {
  __pool?: Pool;
};

const pool = globalForDb.__pool ?? new Pool({ connectionString });
globalForDb.__pool = pool;

export const db = drizzle(pool, { schema });
