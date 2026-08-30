import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// The API can run without PostgreSQL; only DB-backed routes require it.
// Keeping this lazy/optional allows Cloudinary and AI routes to start on Render
// services that do not provision a database.
const databaseUrl = process.env.DATABASE_URL;
export const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
export const db = pool ? drizzle(pool, { schema }) : null;

export * from "./schema";
