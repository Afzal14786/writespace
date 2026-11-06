import { z } from "zod";

import { reactionTypes } from "../../../db/schema/content-reactions";

/**
 * Validates the reaction type supplied by the client.
 *
 * The allowed values come from the shared content-reactions schema,
 * keeping API validation consistent with PostgreSQL.
 */
export const setReactionSchema = z.object({
  body: z.object({
    reactionType: z.enum(reactionTypes),
  }),
});

export type SetReactionDto = z.infer<typeof setReactionSchema>["body"];
