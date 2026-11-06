import { and, desc, eq, inArray, isNotNull, SQL, sql } from "drizzle-orm";

import { Buffer } from "node:buffer";

import { db } from "../../../db";

import {
  articles,
  contentItems,
  contentReactions,
  follows,
  users,
} from "../../../db/schema";

import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";

/**
 * Cursor used for Article feed pagination.
 *
 * Both fields are required:
 * - publishDate determines the primary ordering.
 * - id provides a stable tie-breaker when publication timestamps match.
 */
interface ArticleCursor {
  publishDate: string;
  id: string;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PostgreSQL timestamps are preserved with microsecond precision
 * when generating pagination cursors.
 */
const CURSOR_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/**
 * Encode pagination information as Base64URL.
 *
 * The client must treat the cursor as opaque and send it back unchanged.
 */
function encodeCursor(cursor: ArticleCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

/**
 * Decode and validate a pagination cursor before using its values
 * inside a database query.
 *
 * Cursor values come from the client, so they must never be trusted
 * without validation.
 */
function decodeCursor(value: string): ArticleCursor {
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
      "Invalid Article pagination cursor",
    );
  }
}

class ArticleQueryService {
  /**
   * Retrieve one Article using a database condition.
   *
   * This private method is shared by ID-based and slug-based lookups.
   *
   * Visibility:
   * - The owner may retrieve draft, scheduled and published Articles.
   * - Other users may retrieve published Articles only.
   * - Inaccessible Articles return 404 to avoid exposing their existence.
   */
  private async getArticleByCondition(
    condition: SQL<unknown>,
    requesterId?: string,
  ) {
    const [row] = await db
      .select({
        article: {
          id: articles.id,
          title: articles.title,
          slug: articles.slug,
          subtitle: articles.subtitle,
          contentDocument: articles.contentDocument,
          excerpt: articles.excerpt,
          tags: articles.tags,
          readTime: articles.readTime,

          coverImageUrl: articles.coverImageUrl,
          coverImageAltText: articles.coverImageAltText,
          coverImageCredit: articles.coverImageCredit,

          // Shared fields are read from content_items.
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

        /**
         * Check whether the requester currently has a like reaction.
         *
         * Other reaction types do not count as likes.
         * This remains false when the request is unauthenticated.
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

        /**
         * Check whether the requester follows the Article author.
         */
        isFollowingByMe: requesterId
          ? sql<boolean>`
              EXISTS (
                SELECT 1
                FROM ${follows}
                WHERE ${follows.followerId} = ${requesterId}
                  AND ${follows.followingId} = ${contentItems.authorId}
              )
            `.mapWith(Boolean)
          : sql<boolean>`false`.mapWith(Boolean),
      })
      .from(contentItems)
      .innerJoin(articles, eq(articles.id, contentItems.id))
      .innerJoin(users, eq(users.id, contentItems.authorId))
      .where(and(condition, eq(contentItems.contentType, "article")))
      .limit(1);

    if (!row) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Article not found");
    }

    const isOwner =
      requesterId !== undefined && requesterId === row.article.authorId;

    // Unpublished Articles are visible only to their owner.
    if (!isOwner && row.article.status !== "published") {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Article not found");
    }

    /*
     * Construct a clean cover-image representation.
     *
     * Cloudinary publicId is intentionally excluded from this response.
     */
    const { coverImageUrl, coverImageAltText, coverImageCredit, ...article } =
      row.article;

    const coverImage = coverImageUrl
      ? {
          url: coverImageUrl,
          altText: coverImageAltText,
          credit: coverImageCredit,
        }
      : null;

    return {
      ...article,
      coverImage,
      isLikedByMe: row.isLikedByMe,
      author: row.author,
      isFollowingByMe: row.isFollowingByMe,
    };
  }

  /**
   * Retrieve an Article using its public slug.
   *
   * This should be the primary lookup method for public Article pages.
   *
   * Example:
   * GET /articles/understanding-redis-internals-a1b2c3
   */
  public async getArticleBySlug(slug: string, requesterId?: string) {
    if (!slug.trim() || slug.length > 250) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid Article slug");
    }

    return this.getArticleByCondition(eq(articles.slug, slug), requesterId);
  }

  /**
   * Retrieve an Article using its UUID.
   *
   * This is useful for internal operations such as returning an Article
   * immediately after creation or updating an unpublished Article.
   */
  public async getArticleById(articleId: string, requesterId?: string) {
    if (!UUID_REGEX.test(articleId)) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid Article ID");
    }

    return this.getArticleByCondition(eq(articles.id, articleId), requesterId);
  }

  /**
   * Retrieve a paginated feed of published Articles.
   *
   * Supports:
   * - Cursor-based pagination.
   * - Optional author filtering.
   * - Requester like status.
   * - Requester follow status.
   *
   * Only published Articles with a valid publication timestamp
   * are included in the public feed.
   */
  public async getArticles(
    limit: number,
    cursor?: string,
    requesterId?: string,
    authorIdFilter?: string,
  ) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Article limit must be an integer between 1 and 50",
      );
    }

    if (authorIdFilter && !UUID_REGEX.test(authorIdFilter)) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid author ID");
    }

    const decodedCursor = cursor ? decodeCursor(cursor) : undefined;

    /**
     * Select Article-specific fields and common content fields.
     *
     * cursorPublishDate is internal pagination data. It is removed
     * before the response is returned to the caller.
     */
    const selectFields = {
      id: articles.id,
      title: articles.title,
      slug: articles.slug,
      subtitle: articles.subtitle,
      contentDocument: articles.contentDocument,
      excerpt: articles.excerpt,
      tags: articles.tags,
      readTime: articles.readTime,

      coverImageUrl: articles.coverImageUrl,
      coverImageAltText: articles.coverImageAltText,
      coverImageCredit: articles.coverImageCredit,

      // Common content attributes.
      authorId: contentItems.authorId,
      status: contentItems.status,
      publishDate: contentItems.publishDate,
      viewCount: contentItems.viewCount,
      reactionCount: contentItems.reactionCount,
      commentCount: contentItems.commentCount,
      shareCount: contentItems.shareCount,
      version: contentItems.version,
      createdAt: contentItems.createdAt,
      updatedAt: contentItems.updatedAt,

      // Preserve PostgreSQL microseconds for reliable pagination.
      cursorPublishDate: sql<string>`
        to_char(
          ${contentItems.publishDate} AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        )
      `,

      // Public author information.
      authorUsername: users.username,
      authorFullname: users.fullname,
      authorProfileImage: users.profileImageUrl,

      /**
       * Retrieve whether the requester liked the Article.
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
     * Public Article feed conditions.
     *
     * contentType ensures Posts never appear in the Article feed,
     * even though both content types use content_items.
     */
    const conditions: SQL<unknown>[] = [
      eq(contentItems.contentType, "article"),
      eq(contentItems.status, "published"),
      isNotNull(contentItems.publishDate),
    ];

    if (decodedCursor) {
      /*
       * Feed order is descending by publishDate and ID.
       *
       * The next page contains records with a smaller tuple value
       * than the last Article returned on the previous page.
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

    /*
     * Fetch one extra row to determine whether the feed has another page.
     *
     * Example:
     * Requested limit = 10
     * Database fetch = 11
     * Returned records = 10
     * hasMore = true when the eleventh record exists.
     */
    const result = await db
      .select(selectFields)
      .from(contentItems)
      .innerJoin(articles, eq(articles.id, contentItems.id))
      .innerJoin(users, eq(users.id, contentItems.authorId))
      .where(and(...conditions))
      .orderBy(desc(contentItems.publishDate), desc(contentItems.id))
      .limit(limit + 1);

    const hasMore = result.length > limit;

    const pageResults = result.slice(0, limit);

    /**
     * Determine which Article authors the requester follows.
     *
     * Only authors present on this feed page are checked.
     * This avoids loading the requester's entire following list.
     */
    let followedAuthorIds = new Set<string>();

    if (requesterId && pageResults.length > 0) {
      const authorIds = [
        ...new Set(pageResults.map((article) => article.authorId)),
      ];

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
     * Generate the next cursor using the last Article actually returned.
     *
     * The extra database row is used only to calculate hasMore.
     */
    let nextCursor: string | null = null;

    if (hasMore && pageResults.length > 0) {
      const lastArticle = pageResults[pageResults.length - 1];

      nextCursor = encodeCursor({
        publishDate: lastArticle.cursorPublishDate,
        id: lastArticle.id,
      });
    }

    /**
     * Format Articles for the API response.
     *
     * Internal SQL fields and Cloudinary public IDs are not returned.
     * Cover image metadata is grouped into one nested object.
     */
    const formattedArticles = pageResults.map((row) => {
      const {
        cursorPublishDate,
        coverImageUrl,
        coverImageAltText,
        coverImageCredit,
        authorUsername,
        authorFullname,
        authorProfileImage,
        ...article
      } = row;

      // cursorPublishDate is only required during cursor generation.
      void cursorPublishDate;

      return {
        ...article,

        coverImage: coverImageUrl
          ? {
              url: coverImageUrl,
              altText: coverImageAltText,
              credit: coverImageCredit,
            }
          : null,

        isLikedByMe: row.isLikedByMe,

        author: {
          id: article.authorId,
          username: authorUsername,
          fullname: authorFullname,
          profileImageUrl: authorProfileImage,
          isFollowingByMe: followedAuthorIds.has(article.authorId),
        },
      };
    });

    return {
      articles: formattedArticles,
      nextCursor,
    };
  }
}

export const articleQueryService = new ArticleQueryService();
