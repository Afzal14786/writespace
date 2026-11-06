import { and, asc, eq, isNotNull } from "drizzle-orm";

import { db } from "../../../db";
import { contentItems, postMedia, posts, users } from "../../../db/schema";

import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";

import { extractContentText } from "../domain/post-content";

/**
 * Public information required to generate social sharing metadata.
 *
 * This is deliberately smaller than the complete Post response.
 * Social platforms and metadata generators do not need private
 * interaction data, internal IDs, or Cloudinary identifiers.
 */
export interface PublicPostPreview {
  id: string;
  canonicalPath: string;

  title: string;
  description: string;

  author: {
    name: string;
    username: string;
    profileImageUrl: string | null;
  };

  publishedAt: Date;
  tags: string[];

  image: {
    url: string;
    altText: string | null;
  } | null;
}

/**
 * Maximum lengths for generated metadata.
 *
 * These values keep the preview text manageable across social platforms.
 * They are metadata presentation limits, not Post content limits.
 */
const MAX_TITLE_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 220;

/**
 * Truncate text without splitting Unicode characters.
 *
 * Array.from() operates on Unicode code points, which avoids cutting
 * a surrogate pair in half when the Post contains emoji.
 */
function truncateText(value: string, maxLength: number): string {
  const characters = Array.from(value);

  if (characters.length <= maxLength) {
    return value;
  }

  return `${characters
    .slice(0, maxLength - 1)
    .join("")
    .trimEnd()}…`;
}

/**
 * Prepare metadata-safe text from structured Post content.
 *
 * The Post document is converted into readable plain text, then
 * whitespace is normalized before it is used in social metadata.
 */
function createDescription(content: string, authorName: string): string {
  const normalizedContent = content.replace(/\s+/g, " ").trim();

  if (!normalizedContent) {
    return `Read a post by ${authorName} on Writespace.`;
  }

  return truncateText(normalizedContent, MAX_DESCRIPTION_LENGTH);
}

class PostPreviewService {
  /**
   * Retrieve public preview information for a published Post.
   *
   * Visibility rules:
   * - The content type must be "post".
   * - The status must be "published".
   * - A publication timestamp must exist.
   *
   * Draft and scheduled Posts are treated as not found.
   *
   * The query intentionally selects only fields needed for the
   * public preview. It does not retrieve private engagement data.
   */
  public async getPublicPostPreview(
    postId: string,
  ): Promise<PublicPostPreview> {
    const [post] = await db
      .select({
        id: contentItems.id,
        publishDate: contentItems.publishDate,

        contentDocument: posts.contentDocument,
        tags: posts.tags,

        username: users.username,
        fullname: users.fullname,
        profileImageUrl: users.profileImageUrl,
      })
      .from(contentItems)
      .innerJoin(posts, eq(posts.id, contentItems.id))
      .innerJoin(users, eq(users.id, contentItems.authorId))
      .where(
        and(
          eq(contentItems.id, postId),
          eq(contentItems.contentType, "post"),
          eq(contentItems.status, "published"),
          isNotNull(contentItems.publishDate),
        ),
      )
      .limit(1);

    if (!post || !post.publishDate) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    const authorName = post.fullname?.trim() || post.username;

    /*
     * A Post has no dedicated title field.
     *
     * Use the author's identity for a predictable metadata title,
     * and the actual Post content for the description.
     */
    const title = truncateText(`${authorName} on Writespace`, MAX_TITLE_LENGTH);

    const readableContent = extractContentText(post.contentDocument);

    const description = createDescription(readableContent, authorName);

    /*
     * Use the first attached image as an optional visual asset.
     *
     * This is not the final Open Graph image. The Next.js frontend
     * will generate a branded image using this information when it
     * implements the dynamic opengraph-image route.
     */
    const [firstMedia] = await db
      .select({
        url: postMedia.url,
        altText: postMedia.altText,
      })
      .from(postMedia)
      .where(eq(postMedia.postId, postId))
      .orderBy(asc(postMedia.position))
      .limit(1);

    return {
      id: post.id,

      // The frontend's canonical public Post route.
      canonicalPath: `/posts/${post.id}`,

      title,
      description,

      author: {
        name: authorName,
        username: post.username,
        profileImageUrl: post.profileImageUrl,
      },

      publishedAt: post.publishDate,
      tags: post.tags ?? [],

      image: firstMedia
        ? {
            url: firstMedia.url,
            altText: firstMedia.altText,
          }
        : null,
    };
  }
}

export const postPreviewService = new PostPreviewService();
