export interface SavePostInput {
  actorId: string;
  postId: string;
}

export interface UnsavePostInput {
  actorId: string;
  postId: string;
}

export interface SavedPostResult {
  userId: string;
  postId: string;
  isSaved: boolean;
}

/**
 * Stable pagination position for saved posts.
 *
 * The post ID acts as a tie-breaker when multiple saves
 * have the same creation timestamp.
 */
export interface SavedPostCursor {
  createdAt: string;
  postId: string;
}

export interface SavedPostQuery {
  userId: string;
  limit: number;
  cursor?: string;
}
