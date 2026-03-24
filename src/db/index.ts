import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import env from "../config/env";
import * as schema from "./schema";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  // SCALABILITY FIX: Increase max connections for 1000 concurrent users. 
  // Fallback to 50 if env variable isn't set.
  max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX) : 50,
  min: 5, // Keep a few connections warm
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export const db = drizzle(pool, { schema });
