import type { Article as ArticleRecord, ContentItem } from "../../../db/schema";

import type { ContentDocument } from "../../../db/schema/content-document";

/**
 * Lifecycle states supported by Articles.
 *
 * These values must remain consistent with the content_status
 * PostgreSQL enum used by the shared content_items table.
 *
 * Articles do not have archived or trashed states.
 */
export const ArticleStatus = {
  DRAFT: "draft",
  SCHEDULED: "scheduled",
  PUBLISHED: "published",
} as const;

export type ArticleStatus = (typeof ArticleStatus)[keyof typeof ArticleStatus];

/**
 * Re-export the shared structured document type.
 *
 * Posts and Articles use the same document representation,
 * allowing the editor and document-processing utilities to
 * be shared across both content types.
 */
export type { ContentDocument };

/**
 * Complete application-level Article representation.
 *
 * ArticleRecord contains the Article-specific database fields.
 * ContentItem contributes the fields shared by all publishable content.
 *
 * The contentType discriminator is narrowed to "article" so that
 * Article and Post records remain distinguishable at the type level.
 */
export type Article = ArticleRecord &
  Pick<
    ContentItem,
    | "authorId"
    | "scheduledAt"
    | "publishDate"
    | "viewCount"
    | "reactionCount"
    | "commentCount"
    | "shareCount"
    | "version"
    | "createdAt"
    | "updatedAt"
  > & {
    contentType: "article";
    status: ArticleStatus;
  };

/**
 * Canonical representation of an Article cover image.
 *
 * The application uses:
 * - url for displaying the image.
 * - publicId for managing and deleting the Cloudinary asset.
 * - altText for accessibility.
 * - credit for image attribution.
 *
 * This interface represents an uploaded image.
 * The database cover-image columns remain nullable when no cover exists.
 */
export interface ArticleCoverImage {
  url: string;
  publicId: string;
  altText?: string | null;
  credit?: string | null;
}
