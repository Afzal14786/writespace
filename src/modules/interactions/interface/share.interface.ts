import type { ContentShare } from "../../../db/schema";

/**
 * Generic share representation.
 *
 * A share belongs to a shared content item, which may be a Post
 * or an Article.
 */
export type ContentItemShare = ContentShare;

/**
 * Backward-compatible representation for existing Post-oriented
 * callers that still expect the `postId` property.
 */
export type Share = Omit<ContentShare, "contentItemId"> & {
  postId: string;
};
