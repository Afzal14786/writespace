import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import env from "../config/env";
import logger from "../config/logger";
import * as schema from "./schema";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  min: env.DB_POOL_MIN,
  idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
});

pool.on("error", (error) => {
  logger.error("Unexpected PostgreSQL pool error", {
    error,
  });
});

export const db = drizzle(pool, {
  schema,
});

/**
 * Transaction type inferred from this project's configured Drizzle database.
 *
 * Repositories can accept this type when they need to participate in a
 * transaction started by a feature-level operation. Deriving it from `db`
 * keeps the type aligned with the actual Node PostgreSQL driver and schema.
 */
export type DatabaseTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];
