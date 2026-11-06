import { and, asc, desc, eq, inArray, isNotNull, SQL, sql } from "drizzle-orm";

import { Buffer } from "node:buffer";

import { db } from "../../../db";
import {
  contentItems,
  contentReactions,
  follows,
  postMedia,
  posts,
  users,
} from "../../../db/schema";

import type { PostMedia } from "../../../db/schema";

import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";

/**
 * The pagination cursor contains the exact publication timestamp
 * and Post ID of the last item returned on the previous page.
 *
 * Both values are required because multiple Posts can share the
 * same publication timestamp.
 */
interface PostCursor {
  publishDate: string;
  id: string;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PostgreSQL timestamps can have microsecond precision.
 *
 * The SQL cursor timestamp is formatted with exactly six fractional
 * digits to preserve that precision during pagination.
 */
const CURSOR_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/**
 * Encode cursor data as Base64URL.
 *
 * The client should treat the returned cursor as opaque and send it
 * back unchanged when requesting the next page.
 */
function encodeCursor(cursor: PostCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

/**
 * Decode and validate a pagination cursor before using its values
 * in the database query.
 *
 * Validation is important because cursor values are supplied by clients.
 * Malformed values should produce a controlled 400 response rather
 * than an unexpected database error.
 */
function decodeCursor(value: string): PostCursor {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );

    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("publishDate" in decoded) ||
      !("id" in decoded) ||
      typeof decoded.publishDate !== "string" ||
      typeof decoded.id !== "string" ||
      !CURSOR_DATE_REGEX.test(decoded.publishDate) ||
      Number.isNaN(Date.parse(decoded.publishDate)) ||
      !UUID_REGEX.test(decoded.id)
    ) {
      throw new Error("Invalid cursor payload");
    }

    return {
      publishDate: decoded.publishDate,
      id: decoded.id,
    };
  } catch {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      "Invalid post pagination cursor",
    );
  }
}

class PostQueryService {
  /**
   * Fetch image attachments for one or more Posts.
   *
   * Media records are stored separately in post_media. This method
   * groups the records by Post ID so callers can attach the correct
   * ordered media collection to each Post.
   *
   * A single query is used for a feed page instead of issuing one
   * media query for every Post (avoiding the N+1 query problem).
   */
  private async getMediaByPostIds(
    postIds: string[],
  ): Promise<Map<string, PostMedia[]>> {
    const mediaByPostId = new Map<string, PostMedia[]>();

    if (postIds.length === 0) {
      return mediaByPostId;
    }

    const mediaRecords = await db
      .select()
      .from(postMedia)
      .where(inArray(postMedia.postId, postIds))
      .orderBy(asc(postMedia.postId), asc(postMedia.position));

    for (const media of mediaRecords) {
      const existingMedia = mediaByPostId.get(media.postId) ?? [];

      existingMedia.push(media);

      mediaByPostId.set(media.postId, existingMedia);
    }

    return mediaByPostId;
  }

  /**
   * Fetch one Post by ID.
   *
   * Visibility rules:
   * - The owner can view their own draft, scheduled, and published Posts.
   * - Other users can only view published Posts.
   * - Missing and inaccessible Posts both return 404 to avoid exposing
   *   the existence of private content.
   *
   * The result includes the author profile, ordered media attachments,
   * and whether the requester has liked this Post.
   */
  public async getPost(postId: string, requesterId?: string) {
    const [row] = await db
      .select({
        post: {
          id: posts.id,
          contentDocument: posts.contentDocument,
          tags: posts.tags,

          // Common content fields are owned by content_items.
          authorId: contentItems.authorId,
          status: contentItems.status,
          scheduledAt: contentItems.scheduledAt,
          publishDate: contentItems.publishDate,
          viewCount: contentItems.viewCount,
          reactionCount: contentItems.reactionCount,
          commentCount: contentItems.commentCount,
          shareCount: contentItems.shareCount,
          version: contentItems.version,
          createdAt: contentItems.createdAt,
          updatedAt: contentItems.updatedAt,
        },

        author: {
          id: users.id,
          username: users.username,
          fullname: users.fullname,
          profileImageUrl: users.profileImageUrl,
        },

        /*
         * Keep the existing `isLikedByMe` response property for API
         * compatibility. A reaction of another type does not count as
         * a like.
         */
        isLikedByMe: requesterId
          ? sql<boolean>`
              EXISTS (
                SELECT 1
                FROM ${contentReactions}
                WHERE ${contentReactions.contentItemId} = ${contentItems.id}
                  AND ${contentReactions.userId} = ${requesterId}
                  AND ${contentReactions.reactionType} = 'like'
              )
            `.mapWith(Boolean)
          : sql<boolean>`false`.mapWith(Boolean),
      })
      .from(contentItems)
      .innerJoin(posts, eq(posts.id, contentItems.id))
      .innerJoin(users, eq(users.id, contentItems.authorId))
      .where(
        and(eq(contentItems.id, postId), eq(contentItems.contentType, "post")),
      )
      .limit(1);

    if (!row) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    const isOwner =
      requesterId !== undefined && requesterId === row.post.authorId;

    // Never expose an unpublished Post to anyone other than its owner.
    if (!isOwner && row.post.status !== "published") {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    // Fetch media only after confirming that the requester can view the Post.
    const mediaByPostId = await this.getMediaByPostIds([postId]);

    return {
      ...row.post,
      media: mediaByPostId.get(postId) ?? [],
      isLikedByMe: row.isLikedByMe,
      author: row.author,
    };
  }

  /**
   * Fetch a paginated feed of published Posts.
   *
   * Pagination uses the tuple:
   *
   *     (publishDate, id)
   *
   * Both fields are ordered descending. The Post ID acts as a stable
   * tie-breaker when two Posts have the same publication timestamp.
   *
   * One additional row is fetched to determine whether another page exists.
   */
  public async getPosts(
    limit: number,
    cursor?: string,
    requesterId?: string,
    authorIdFilter?: string,
  ) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Post limit must be an integer between 1 and 50",
      );
    }

    if (authorIdFilter && !UUID_REGEX.test(authorIdFilter)) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid author ID");
    }

    const decodedCursor = cursor ? decodeCursor(cursor) : undefined;

    /**
     * Select Post-specific and shared content fields separately.
     *
     * `cursorPublishDate` is an internal field used only to generate
     * the next pagination cursor. It is removed before returning the
     * response to the caller.
     */
    const selectFields = {
      id: posts.id,
      contentDocument: posts.contentDocument,
      tags: posts.tags,

      authorId: contentItems.authorId,
      status: contentItems.status,
      publishDate: contentItems.publishDate,
      viewCount: contentItems.viewCount,
      reactionCount: contentItems.reactionCount,
      commentCount: contentItems.commentCount,
      shareCount: contentItems.shareCount,
      createdAt: contentItems.createdAt,
      updatedAt: contentItems.updatedAt,

      // Preserve microseconds for stable pagination across pages.
      cursorPublishDate: sql<string>`
        to_char(
          ${contentItems.publishDate} AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        )
      `,

      authorUsername: users.username,
      authorProfileImage: users.profileImageUrl,
      authorFullname: users.fullname,

      /**
       * Preserve the old API property while reading reactions from
       * the shared content_reactions table.
       */
      isLikedByMe: requesterId
        ? sql<boolean>`
            EXISTS (
              SELECT 1
              FROM ${contentReactions}
              WHERE ${contentReactions.contentItemId} = ${contentItems.id}
                AND ${contentReactions.userId} = ${requesterId}
                AND ${contentReactions.reactionType} = 'like'
            )
          `.mapWith(Boolean)
        : sql<boolean>`false`.mapWith(Boolean),
    };

    /**
     * A feed contains only published Posts with a publication timestamp.
     *
     * Checking contentType is important because content_items is now
     * shared by Posts and Articles.
     */
    const conditions: SQL<unknown>[] = [
      eq(contentItems.contentType, "post"),
      eq(contentItems.status, "published"),
      isNotNull(contentItems.publishDate),
    ];

    if (decodedCursor) {
      /*
       * For descending order, the next page contains records whose
       * (publishDate, id) tuple is smaller than the previous page's
       * last tuple.
       */
      conditions.push(
        sql`(
          ${contentItems.publishDate},
          ${contentItems.id}
        ) < (
          ${decodedCursor.publishDate}::timestamptz,
          ${decodedCursor.id}::uuid
        )`,
      );
    }

    if (authorIdFilter) {
      conditions.push(eq(contentItems.authorId, authorIdFilter));
    }

    const result = await db
      .select(selectFields)
      .from(contentItems)
      .innerJoin(posts, eq(posts.id, contentItems.id))
      .innerJoin(users, eq(users.id, contentItems.authorId))
      .where(and(...conditions))
      .orderBy(desc(contentItems.publishDate), desc(contentItems.id))
      .limit(limit + 1);

    const hasMore = result.length > limit;

    // The extra record is not returned. It is used only for hasMore.
    const pageResults = result.slice(0, limit);

    const postIds = pageResults.map((post) => post.id);

    /**
     * Load every attachment for this page in one query.
     * The returned map keeps the attachment records grouped by Post ID.
     */
    const mediaByPostId = await this.getMediaByPostIds(postIds);

    /**
     * Determine which authors the requester follows.
     *
     * We query only the authors present in the current page instead
     * of loading the requester's entire following list.
     */
    let followedAuthorIds = new Set<string>();

    if (requesterId && pageResults.length > 0) {
      const authorIds = [...new Set(pageResults.map((post) => post.authorId))];

      const userFollows = await db
        .select({
          followingId: follows.followingId,
        })
        .from(follows)
        .where(
          and(
            eq(follows.followerId, requesterId),
            inArray(follows.followingId, authorIds),
          ),
        );

      followedAuthorIds = new Set(
        userFollows.map((follow) => follow.followingId),
      );
    }

    /**
     * Generate the next cursor from the last Post actually returned.
     * The extra row is never used as the cursor boundary.
     */
    let nextCursor: string | null = null;

    if (hasMore && pageResults.length > 0) {
      const lastPost = pageResults[pageResults.length - 1];

      nextCursor = encodeCursor({
        publishDate: lastPost.cursorPublishDate,
        id: lastPost.id,
      });
    }

    /**
     * Build the public response.
     *
     * Internal pagination data and author join aliases are removed.
     * Each Post receives its ordered media list and author information.
     */
    const formattedPosts = pageResults.map((row) => {
      const {
        authorUsername,
        authorProfileImage,
        authorFullname,
        cursorPublishDate,
        ...post
      } = row;

      // This value has already been used to generate the cursor.
      void cursorPublishDate;

      return {
        ...post,
        media: mediaByPostId.get(post.id) ?? [],
        isLikedByMe: row.isLikedByMe,

        author: {
          id: post.authorId,
          username: authorUsername,
          fullname: authorFullname,
          profileImageUrl: authorProfileImage,
          isFollowingByMe: followedAuthorIds.has(post.authorId),
        },
      };
    });

    return {
      posts: formattedPosts,
      nextCursor,
    };
  }
}

export const postQueryService = new PostQueryService();
