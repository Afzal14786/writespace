import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../../../db";

import {
  articles,
  contentItems,
  contentSaves,
  posts,
} from "../../../db/schema";

import type { SavedPostCursor } from "../contracts/save.types";

/**
 * Generic cursor for saved content.
 *
 * Unlike SavedPostCursor, this uses contentItemId because
 * saved content can represent either a Post or an Article.
 */
export interface SavedContentCursor {
  createdAt: string;
  contentItemId: string;
}

export class SaveRepository {
  // ---------------------------------------------------------------------------
  // Content item validation
  // ---------------------------------------------------------------------------

  /**
   * Check whether a content item exists and has a valid content subtype.
   *
   * Both Posts and Articles are stored in content_items.
   * The subtype determines which content-specific table owns the record.
   */
  public async findContentItem(contentItemId: string) {
    const [contentItem] = await db
      .select({
        id: contentItems.id,
        contentType: contentItems.contentType,
        status: contentItems.status,
      })
      .from(contentItems)
      .where(
        and(
          eq(contentItems.id, contentItemId),
          inArray(contentItems.contentType, ["post", "article"]),
        ),
      )
      .limit(1);

    if (!contentItem) {
      return null;
    }

    // Verify that the matching subtype record exists.
    if (contentItem.contentType === "post") {
      const [post] = await db
        .select({ id: posts.id })
        .from(posts)
        .where(eq(posts.id, contentItemId))
        .limit(1);

      return post ? contentItem : null;
    }

    const [article] = await db
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.id, contentItemId))
      .limit(1);

    return article ? contentItem : null;
  }

  /**
   * Legacy Post-specific existence check.
   *
   * New application code should use findContentItem().
   */
  public async findPost(postId: string) {
    const [result] = await db
      .select({
        id: contentItems.id,
      })
      .from(contentItems)
      .innerJoin(posts, eq(posts.id, contentItems.id))
      .where(
        and(eq(contentItems.id, postId), eq(contentItems.contentType, "post")),
      )
      .limit(1);

    return result ?? null;
  }

  // ---------------------------------------------------------------------------
  // Content item save relationships
  // ---------------------------------------------------------------------------

  /**
   * Find an existing save relationship.
   *
   * The database identifies the relationship using:
   * (contentItemId, userId).
   */
  public async findContentItemSave(userId: string, contentItemId: string) {
    const [save] = await db
      .select({
        contentItemId: contentSaves.contentItemId,
        userId: contentSaves.userId,
        createdAt: contentSaves.createdAt,
      })
      .from(contentSaves)
      .where(
        and(
          eq(contentSaves.userId, userId),
          eq(contentSaves.contentItemId, contentItemId),
        ),
      )
      .limit(1);

    return save ?? null;
  }

  /**
   * Determine whether a user has saved a content item.
   */
  public async isContentItemSaved(
    userId: string,
    contentItemId: string,
  ): Promise<boolean> {
    const [result] = await db
      .select({
        exists: sql<boolean>`true`,
      })
      .from(contentSaves)
      .where(
        and(
          eq(contentSaves.userId, userId),
          eq(contentSaves.contentItemId, contentItemId),
        ),
      )
      .limit(1);

    return Boolean(result);
  }

  /**
   * Create a save relationship for a Post or Article.
   *
   * The composite primary key prevents duplicate saves.
   * Repeated save requests are therefore idempotent.
   */
  public async createContentItemSave(userId: string, contentItemId: string) {
    const [save] = await db
      .insert(contentSaves)
      .values({
        userId,
        contentItemId,
      })
      .onConflictDoNothing({
        target: [contentSaves.contentItemId, contentSaves.userId],
      })
      .returning({
        contentItemId: contentSaves.contentItemId,
        userId: contentSaves.userId,
        createdAt: contentSaves.createdAt,
      });

    return save ?? null;
  }

  /**
   * Remove a save relationship.
   *
   * Returns null if the user has not saved this content item.
   */
  public async deleteContentItemSave(userId: string, contentItemId: string) {
    const [deleted] = await db
      .delete(contentSaves)
      .where(
        and(
          eq(contentSaves.userId, userId),
          eq(contentSaves.contentItemId, contentItemId),
        ),
      )
      .returning({
        contentItemId: contentSaves.contentItemId,
        userId: contentSaves.userId,
        createdAt: contentSaves.createdAt,
      });

    return deleted ?? null;
  }

  // ---------------------------------------------------------------------------
  // Saved content pagination
  // ---------------------------------------------------------------------------

  /**
   * Retrieve saved Posts and Articles using stable cursor pagination.
   *
   * Ordering:
   * 1. createdAt descending
   * 2. contentItemId descending
   *
   * The ID is a deterministic tie-breaker when multiple saves
   * share the same timestamp.
   *
   * PostgreSQL microseconds are preserved in cursorCreatedAt
   * to prevent pagination inconsistencies caused by JavaScript
   * Date precision loss.
   */
  public async getSavedContent(
    userId: string,
    limit: number,
    cursor?: SavedContentCursor,
  ) {
    const conditions = [
      eq(contentSaves.userId, userId),
      inArray(contentItems.contentType, ["post", "article"]),
    ];

    if (cursor) {
      conditions.push(
        sql`(
          ${contentSaves.createdAt} < ${cursor.createdAt}::timestamptz
          OR (
            ${contentSaves.createdAt} = ${cursor.createdAt}::timestamptz
            AND ${contentSaves.contentItemId} < ${cursor.contentItemId}::uuid
          )
        )`,
      );
    }

    return db
      .select({
        contentItemId: contentSaves.contentItemId,
        contentType: contentItems.contentType,
        userId: contentSaves.userId,
        createdAt: contentSaves.createdAt,

        cursorCreatedAt: sql<string>`
          to_char(
            ${contentSaves.createdAt} AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          )
        `,
      })
      .from(contentSaves)
      .innerJoin(contentItems, eq(contentItems.id, contentSaves.contentItemId))
      .where(and(...conditions))
      .orderBy(desc(contentSaves.createdAt), desc(contentSaves.contentItemId))
      .limit(limit);
  }

  // ---------------------------------------------------------------------------
  // Backward-compatible Post methods
  // ---------------------------------------------------------------------------

  /**
   * @deprecated Use findContentItemSave().
   */
  public async findSave(userId: string, postId: string) {
    const save = await this.findContentItemSave(userId, postId);

    if (!save) {
      return null;
    }

    return {
      postId: save.contentItemId,
      userId: save.userId,
      createdAt: save.createdAt,
    };
  }

  /**
   * @deprecated Use isContentItemSaved().
   */
  public async isPostSaved(userId: string, postId: string): Promise<boolean> {
    return this.isContentItemSaved(userId, postId);
  }

  /**
   * @deprecated Use createContentItemSave().
   */
  public async createSave(userId: string, postId: string) {
    const save = await this.createContentItemSave(userId, postId);

    if (!save) {
      return null;
    }

    return {
      postId: save.contentItemId,
      userId: save.userId,
      createdAt: save.createdAt,
    };
  }

  /**
   * @deprecated Use deleteContentItemSave().
   */
  public async deleteSave(userId: string, postId: string) {
    const deleted = await this.deleteContentItemSave(userId, postId);

    if (!deleted) {
      return null;
    }

    return {
      postId: deleted.contentItemId,
      userId: deleted.userId,
      createdAt: deleted.createdAt,
    };
  }

  /**
   * @deprecated Use getSavedContent().
   *
   * This method deliberately returns Posts only, preserving
   * the old saved-Posts API behavior.
   */
  public async getSavedPosts(
    userId: string,
    limit: number,
    cursor?: SavedPostCursor,
  ) {
    const conditions = [
      eq(contentSaves.userId, userId),
      eq(contentItems.contentType, "post"),
    ];

    if (cursor) {
      conditions.push(
        sql`(
          ${contentSaves.createdAt} < ${cursor.createdAt}::timestamptz
          OR (
            ${contentSaves.createdAt} = ${cursor.createdAt}::timestamptz
            AND ${contentSaves.contentItemId} < ${cursor.postId}::uuid
          )
        )`,
      );
    }

    return db
      .select({
        postId: contentSaves.contentItemId,
        userId: contentSaves.userId,
        createdAt: contentSaves.createdAt,

        cursorCreatedAt: sql<string>`
          to_char(
            ${contentSaves.createdAt} AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          )
        `,
      })
      .from(contentSaves)
      .innerJoin(contentItems, eq(contentItems.id, contentSaves.contentItemId))
      .innerJoin(posts, eq(posts.id, contentItems.id))
      .where(and(...conditions))
      .orderBy(desc(contentSaves.createdAt), desc(contentSaves.contentItemId))
      .limit(limit);
  }
}

export const saveRepository = new SaveRepository();
