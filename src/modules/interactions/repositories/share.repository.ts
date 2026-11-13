import { and, desc, eq, sql } from "drizzle-orm";

import { db, type DatabaseTransaction } from "../../../db";
import { contentItems, contentShares, posts } from "../../../db/schema";

import type { ShareCursor } from "../contracts/share.types";

export class ShareRepository {
  /**
   * Finds a shared content item, regardless of whether it is a Post
   * or an Article.
   */
  async findContentItem(contentItemId: string) {
    const result = await db
      .select({
        id: contentItems.id,
        contentType: contentItems.contentType,
      })
      .from(contentItems)
      .where(eq(contentItems.id, contentItemId))
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Legacy Post-specific lookup.
   *
   * Keep this for callers that explicitly require a Post rather than
   * any shared content item.
   */
  async findPost(postId: string) {
    const result = await db
      .select({
        id: contentItems.id,
      })
      .from(contentItems)
      .innerJoin(posts, eq(posts.id, contentItems.id))
      .where(
        and(eq(contentItems.id, postId), eq(contentItems.contentType, "post")),
      )
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Creates a share for any content item and increments its share count
   * in the same transaction.
   *
   * Multiple share records for the same user and content item are
   * intentional. Each recorded share action is a separate interaction.
   */
  private async createContentItemShareInTransaction(
    transaction: DatabaseTransaction,
    userId: string,
    contentItemId: string,
    platform: string,
  ) {
    /*
     * Lock and validate the parent content item before recording a share.
     *
     * This protects the invariant at the database boundary instead of
     * relying exclusively on the earlier application-level check.
     */
    const [contentItem] = await transaction
      .select({
        id: contentItems.id,
        contentType: contentItems.contentType,
        status: contentItems.status,
      })
      .from(contentItems)
      .where(eq(contentItems.id, contentItemId))
      .for("update")
      .limit(1);

    if (
      !contentItem ||
      contentItem.status !== "published" ||
      (contentItem.contentType !== "post" &&
        contentItem.contentType !== "article")
    ) {
      return null;
    }

    const [createdShare] = await transaction
      .insert(contentShares)
      .values({
        userId,
        contentItemId,
        platform,
      })
      .returning({
        id: contentShares.id,
        userId: contentShares.userId,
        contentItemId: contentShares.contentItemId,

        // Compatibility property for existing Post-oriented callers.
        postId: contentShares.contentItemId,

        platform: contentShares.platform,
        createdAt: contentShares.createdAt,
      });

    if (!createdShare) {
      return null;
    }

    // Keep the share record and its counter update atomic.
    await transaction
      .update(contentItems)
      .set({
        shareCount: sql`${contentItems.shareCount} + 1`,
      })
      .where(eq(contentItems.id, contentItemId));

    return createdShare;
  }

  /**
   * Creates a share and increments the content item's share count.
   *
   * A supplied transaction allows the caller to include the outbox event
   * in the same transaction.
   */
  public async createContentItemShare(
    userId: string,
    contentItemId: string,
    platform: string,
    transaction?: DatabaseTransaction,
  ) {
    if (transaction) {
      return this.createContentItemShareInTransaction(
        transaction,
        userId,
        contentItemId,
        platform,
      );
    }

    return db.transaction((tx) =>
      this.createContentItemShareInTransaction(
        tx,
        userId,
        contentItemId,
        platform,
      ),
    );
  }

  /**
   * Legacy method retained for existing Post callers.
   */
  async createShare(
    userId: string,
    postId: string,
    platform: string,
    transaction?: DatabaseTransaction,
  ) {
    return this.createContentItemShare(userId, postId, platform, transaction);
  }

  /**
   * Retrieves one share record.
   *
   * Both contentItemId and the legacy postId property are returned
   * so generic and existing callers can coexist during migration.
   */
  async getShareById(id: number) {
    const result = await db
      .select({
        id: contentShares.id,
        userId: contentShares.userId,
        contentItemId: contentShares.contentItemId,
        postId: contentShares.contentItemId,
        platform: contentShares.platform,
        createdAt: contentShares.createdAt,
      })
      .from(contentShares)
      .where(eq(contentShares.id, id))
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Retrieves shares for any content item using stable cursor pagination.
   *
   * Ordering:
   * 1. createdAt descending
   * 2. id descending
   *
   * cursorCreatedAt preserves PostgreSQL microsecond precision.
   */
  async getContentItemShares(
    contentItemId: string,
    limit: number,
    cursor?: ShareCursor,
  ) {
    const conditions = [eq(contentShares.contentItemId, contentItemId)];

    if (cursor) {
      conditions.push(sql`(
        ${contentShares.createdAt} < ${cursor.createdAt}::timestamptz
        OR (
          ${contentShares.createdAt} = ${cursor.createdAt}::timestamptz
          AND ${contentShares.id} < ${cursor.id}::integer
        )
      )`);
    }

    return db
      .select({
        id: contentShares.id,
        userId: contentShares.userId,
        contentItemId: contentShares.contentItemId,
        postId: contentShares.contentItemId,
        platform: contentShares.platform,
        createdAt: contentShares.createdAt,
        cursorCreatedAt: sql<string>`
          to_char(
            ${contentShares.createdAt} AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          )
        `,
      })
      .from(contentShares)
      .where(and(...conditions))
      .orderBy(desc(contentShares.createdAt), desc(contentShares.id))
      .limit(limit);
  }

  /**
   * Legacy Post-specific pagination method.
   */
  async getPostShares(postId: string, limit: number, cursor?: ShareCursor) {
    const shares = await this.getContentItemShares(postId, limit, cursor);

    return shares.map(({ contentItemId: _contentItemId, ...share }) => share);
  }

  /**
   * Retrieves shares made by a particular user for any content item.
   */
  async getUserContentItemShares(userId: string, contentItemId: string) {
    return db
      .select({
        id: contentShares.id,
        userId: contentShares.userId,
        contentItemId: contentShares.contentItemId,
        postId: contentShares.contentItemId,
        platform: contentShares.platform,
        createdAt: contentShares.createdAt,
      })
      .from(contentShares)
      .where(
        and(
          eq(contentShares.userId, userId),
          eq(contentShares.contentItemId, contentItemId),
        ),
      )
      .orderBy(desc(contentShares.createdAt), desc(contentShares.id));
  }

  /**
   * Legacy Post-specific lookup method.
   */
  async getUserPostShares(userId: string, postId: string) {
    const shares = await this.getUserContentItemShares(userId, postId);

    return shares.map(({ contentItemId: _contentItemId, ...share }) => share);
  }
}

export const shareRepository = new ShareRepository();
