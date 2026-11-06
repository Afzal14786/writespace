import { db } from "../../db";

/**
 * Every seed module receives the same transaction executor.
 *
 * This ensures that all modules participate in one database transaction
 * instead of committing their records independently.
 */
export type SeedTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];
