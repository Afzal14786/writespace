import { Comment } from "../../../db/schema";

export type { Comment };

/**
 * Identifies the last comment returned on a page.
 *
 * Both fields are required to maintain a deterministic order when
 * multiple comments have the same creation timestamp.
 *
 * The timestamp is kept as a string to preserve PostgreSQL precision.
 */
export interface CommentCursor {
  createdAt: string;
  id: string;
}
