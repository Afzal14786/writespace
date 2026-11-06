import type { ContentItem, Post as PostRecord } from "../../../db/schema";

import type { ContentDocument } from "../../../db/schema/content-document";

/**
 * Re-export the structured document type for the Posts module.
 *
 * The same document format is shared with Articles, but each module
 * applies its own content-length and publishing rules.
 */
export type { ContentDocument };

/**
 * A Post combines its subtype-specific fields with the common fields
 * stored in content_items.
 *
 * The database still keeps these in two separate tables:
 * - posts: contentDocument and tags
 * - content_items: author, status, counters, and timestamps
 *
 * This intersection is useful when working with a joined Post result.
 */
export type Post = PostRecord &
  Pick<
    ContentItem,
    | "contentType"
    | "authorId"
    | "status"
    | "scheduledAt"
    | "publishDate"
    | "viewCount"
    | "reactionCount"
    | "commentCount"
    | "shareCount"
    | "version"
    | "createdAt"
    | "updatedAt"
  >;

/**
 * Short Posts have only three lifecycle states.
 *
 * Unlike the old implementation, Posts are not archived or moved to trash.
 * Deletion is permanent and handled by the command service.
 */
export enum PostStatus {
  DRAFT = "draft",
  SCHEDULED = "scheduled",
  PUBLISHED = "published",
}

/**
 * An image attached to a Post.
 *
 * `publicId` is retained so the server can remove the correct asset
 * from Cloudinary when an attachment is replaced or the Post is deleted.
 */
export interface PostMediaItem {
  url: string;
  publicId: string;
  altText?: string | null;
}
