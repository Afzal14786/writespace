export interface CreateContentItemShareInput {
  actorId: string;
  contentItemId: string;
  platform: string;
}

/**
 * Legacy Post-specific input.
 * Keep this while existing Post routes and callers use postId.
 */
export interface CreateShareInput {
  actorId: string;
  postId: string;
  platform: string;
}

export interface ContentItemShareResult {
  id: number;
  userId: string;
  contentItemId: string;
  platform: string;
  createdAt: Date;
}

/**
 * Legacy Post-oriented response.
 */
export interface ShareResult {
  id: number;
  userId: string;
  postId: string;
  platform: string;
  createdAt: Date;
}

/**
 * Stable pagination position for share records.
 *
 * The serial share ID is used as a tie-breaker when multiple
 * share records have the same creation timestamp.
 */
export interface ShareCursor {
  createdAt: string;
  id: number;
}

/**
 * Paginated response for shares belonging to any content item.
 */
export interface ContentItemSharePageResult {
  shares: ContentItemShareResult[];
  nextCursor: string | null;
}

/**
 * Legacy Post-oriented paginated response.
 */
export interface SharePageResult {
  shares: ShareResult[];
  nextCursor: string | null;
}
