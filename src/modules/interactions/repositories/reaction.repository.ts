import { and, eq, sql } from "drizzle-orm";

import { db, type DatabaseTransaction } from "../../../db";

import {
  articles,
  commentReactions,
  comments,
  contentItems,
  contentReactions,
  posts,
} from "../../../db/schema";

import type { ReactionType } from "../contracts/reaction.types";

export class ReactionRepository {
  /**
   * Use a caller-owned transaction when supplied.
   *
   * The optional transaction keeps existing repository callers backward
   * compatible, while allowing ReactionService to write the business change
   * and its notification outbox event atomically in one transaction.
   */
  private withTransaction<T>(
    transaction: DatabaseTransaction | undefined,
    operation: (tx: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    return transaction ? operation(transaction) : db.transaction(operation);
  }

  // ---------------------------------------------------------------------------
  // Content item reactions
  // ---------------------------------------------------------------------------

  /**
   * Find a user's current reaction on a content item.
   *
   * A content item can represent either a Post or an Article.
   */
  public async findContentItemReaction(contentItemId: string, userId: string) {
    const [reaction] = await db
      .select({
        contentItemId: contentReactions.contentItemId,
        userId: contentReactions.userId,
        reactionType: contentReactions.reactionType,
      })
      .from(contentReactions)
      .where(
        and(
          eq(contentReactions.contentItemId, contentItemId),
          eq(contentReactions.userId, userId),
        ),
      )
      .limit(1);

    return reaction ?? null;
  }

  /**
   * Create or change a reaction on a published Post or Article.
   *
   * The content item row is locked first. This serializes reaction
   * mutations for the same content item and protects its aggregate counter.
   *
   * Counter behavior:
   * - New reaction: increment reactionCount.
   * - Changed reaction type: counter unchanged.
   * - Repeated identical reaction: no change.
   *
   * When a transaction is supplied, the caller is responsible for committing
   * both this change and any associated outbox event.
   */
  public async setContentItemReaction(
    contentItemId: string,
    userId: string,
    reactionType: ReactionType,
    transaction?: DatabaseTransaction,
  ) {
    return this.withTransaction(transaction, async (tx) => {
      const [contentItem] = await tx
        .select({
          id: contentItems.id,
          contentType: contentItems.contentType,
          status: contentItems.status,
        })
        .from(contentItems)
        .where(eq(contentItems.id, contentItemId))
        .for("update")
        .limit(1);

      if (!contentItem || contentItem.status !== "published") {
        return null;
      }

      // Verify that the matching subtype record exists.
      let subtypeExists = false;

      if (contentItem.contentType === "post") {
        const [post] = await tx
          .select({ id: posts.id })
          .from(posts)
          .where(eq(posts.id, contentItemId))
          .limit(1);

        subtypeExists = Boolean(post);
      } else if (contentItem.contentType === "article") {
        const [article] = await tx
          .select({ id: articles.id })
          .from(articles)
          .where(eq(articles.id, contentItemId))
          .limit(1);

        subtypeExists = Boolean(article);
      }

      if (!subtypeExists) {
        return null;
      }

      const [existing] = await tx
        .select({
          reactionType: contentReactions.reactionType,
        })
        .from(contentReactions)
        .where(
          and(
            eq(contentReactions.contentItemId, contentItemId),
            eq(contentReactions.userId, userId),
          ),
        )
        .for("update")
        .limit(1);

      if (!existing) {
        const [inserted] = await tx
          .insert(contentReactions)
          .values({
            contentItemId,
            userId,
            reactionType,
          })
          .onConflictDoNothing({
            target: [contentReactions.contentItemId, contentReactions.userId],
          })
          .returning();

        if (!inserted) {
          // A conflicting writer may have inserted the reaction.
          const [concurrentExisting] = await tx
            .select({
              reactionType: contentReactions.reactionType,
            })
            .from(contentReactions)
            .where(
              and(
                eq(contentReactions.contentItemId, contentItemId),
                eq(contentReactions.userId, userId),
              ),
            )
            .for("update")
            .limit(1);

          if (!concurrentExisting) {
            return null;
          }

          const previousReactionType = concurrentExisting.reactionType;

          if (previousReactionType === reactionType) {
            return {
              previousReactionType,
              reaction: concurrentExisting,
            };
          }

          const [updated] = await tx
            .update(contentReactions)
            .set({
              reactionType,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(contentReactions.contentItemId, contentItemId),
                eq(contentReactions.userId, userId),
              ),
            )
            .returning();

          return updated
            ? {
                previousReactionType,
                reaction: updated,
              }
            : null;
        }

        await tx
          .update(contentItems)
          .set({
            reactionCount: sql`${contentItems.reactionCount} + 1`,
          })
          .where(eq(contentItems.id, contentItemId));

        return {
          previousReactionType: null,
          reaction: inserted,
        };
      }

      const previousReactionType = existing.reactionType;

      if (previousReactionType === reactionType) {
        return {
          previousReactionType,
          reaction: existing,
        };
      }

      const [updated] = await tx
        .update(contentReactions)
        .set({
          reactionType,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(contentReactions.contentItemId, contentItemId),
            eq(contentReactions.userId, userId),
          ),
        )
        .returning();

      return updated
        ? {
            previousReactionType,
            reaction: updated,
          }
        : null;
    });
  }

  /**
   * Atomically toggle the Like reaction for a Post or Article.
   *
   * - No reaction: create Like and increment the counter.
   * - Existing Like: remove it and decrement the counter.
   * - Different reaction: change it to Like without changing the counter.
   *
   * Removing an existing Like is allowed even when the content is no
   * longer published. Creating or changing a reaction requires publication.
   */
  public async toggleContentItemLike(
    contentItemId: string,
    userId: string,
    transaction?: DatabaseTransaction,
  ) {
    return this.withTransaction(transaction, async (tx) => {
      const [item] = await tx
        .select({
          id: contentItems.id,
          contentType: contentItems.contentType,
          status: contentItems.status,
        })
        .from(contentItems)
        .where(eq(contentItems.id, contentItemId))
        .for("update")
        .limit(1);

      if (!item) {
        return null;
      }

      let subtypeExists = false;

      if (item.contentType === "post") {
        const [post] = await tx
          .select({ id: posts.id })
          .from(posts)
          .where(eq(posts.id, contentItemId))
          .limit(1);

        subtypeExists = Boolean(post);
      } else if (item.contentType === "article") {
        const [article] = await tx
          .select({ id: articles.id })
          .from(articles)
          .where(eq(articles.id, contentItemId))
          .limit(1);

        subtypeExists = Boolean(article);
      }

      if (!subtypeExists) {
        return null;
      }

      const [existing] = await tx
        .select({
          reactionType: contentReactions.reactionType,
        })
        .from(contentReactions)
        .where(
          and(
            eq(contentReactions.contentItemId, contentItemId),
            eq(contentReactions.userId, userId),
          ),
        )
        .for("update")
        .limit(1);

      // Existing Like: remove it.
      if (existing?.reactionType === "like") {
        const [deleted] = await tx
          .delete(contentReactions)
          .where(
            and(
              eq(contentReactions.contentItemId, contentItemId),
              eq(contentReactions.userId, userId),
            ),
          )
          .returning();

        if (!deleted) {
          return null;
        }

        await tx
          .update(contentItems)
          .set({
            reactionCount: sql`GREATEST(${contentItems.reactionCount} - 1, 0)`,
          })
          .where(eq(contentItems.id, contentItemId));

        return {
          action: "removed" as const,
          previousReactionType: "like" as const,
          reactionType: null,
        };
      }

      // New Likes and reaction changes require published content.
      if (item.status !== "published") {
        return null;
      }

      // Change an existing reaction to Like.
      if (existing) {
        const [updated] = await tx
          .update(contentReactions)
          .set({
            reactionType: "like",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(contentReactions.contentItemId, contentItemId),
              eq(contentReactions.userId, userId),
            ),
          )
          .returning();

        if (!updated) {
          return null;
        }

        return {
          action: "changed" as const,
          previousReactionType: existing.reactionType,
          reactionType: updated.reactionType,
        };
      }

      // No reaction exists: create a new Like.
      const [inserted] = await tx
        .insert(contentReactions)
        .values({
          contentItemId,
          userId,
          reactionType: "like",
        })
        .onConflictDoNothing({
          target: [contentReactions.contentItemId, contentReactions.userId],
        })
        .returning();

      if (!inserted) {
        return null;
      }

      await tx
        .update(contentItems)
        .set({
          reactionCount: sql`${contentItems.reactionCount} + 1`,
        })
        .where(eq(contentItems.id, contentItemId));

      return {
        action: "added" as const,
        previousReactionType: null,
        reactionType: inserted.reactionType,
      };
    });
  }

  /**
   * Remove a user's reaction from a content item.
   *
   * The parent content row is locked before deleting the reaction.
   * The counter changes only when a reaction was actually deleted.
   */
  public async deleteContentItemReaction(
    contentItemId: string,
    userId: string,
    transaction?: DatabaseTransaction,
  ) {
    return this.withTransaction(transaction, async (tx) => {
      const [contentItem] = await tx
        .select({
          id: contentItems.id,
        })
        .from(contentItems)
        .where(eq(contentItems.id, contentItemId))
        .for("update")
        .limit(1);

      if (!contentItem) {
        return null;
      }

      const [deleted] = await tx
        .delete(contentReactions)
        .where(
          and(
            eq(contentReactions.contentItemId, contentItemId),
            eq(contentReactions.userId, userId),
          ),
        )
        .returning();

      if (!deleted) {
        return null;
      }

      await tx
        .update(contentItems)
        .set({
          reactionCount: sql`GREATEST(${contentItems.reactionCount} - 1, 0)`,
        })
        .where(eq(contentItems.id, contentItemId));

      return deleted;
    });
  }

  /**
   * Retrieve reaction counts grouped by reaction type.
   */
  public async getContentItemReactionCounts(contentItemId: string) {
    return db
      .select({
        reactionType: contentReactions.reactionType,
        count: sql<number>`count(*)::int`,
      })
      .from(contentReactions)
      .where(eq(contentReactions.contentItemId, contentItemId))
      .groupBy(contentReactions.reactionType);
  }

  // ---------------------------------------------------------------------------
  // Comment reactions
  // ---------------------------------------------------------------------------

  /**
   * Find a user's current reaction on a comment.
   */
  public async findCommentReaction(commentId: string, userId: string) {
    const [reaction] = await db
      .select({
        commentId: commentReactions.commentId,
        userId: commentReactions.userId,
        reactionType: commentReactions.reactionType,
      })
      .from(commentReactions)
      .where(
        and(
          eq(commentReactions.commentId, commentId),
          eq(commentReactions.userId, userId),
        ),
      )
      .limit(1);

    return reaction ?? null;
  }

  /**
   * Create or change a reaction on a comment.
   *
   * Only a newly inserted reaction increments comments.reactionCount.
   */
  public async setCommentReaction(
    commentId: string,
    userId: string,
    reactionType: ReactionType,
    transaction?: DatabaseTransaction,
  ) {
    return this.withTransaction(transaction, async (tx) => {
      /*
       * Resolve the parent content item before changing the reaction.
       *
       * The initial lookup is intentionally unlocked. We then lock the
       * content item first, matching the lock order used by comment
       * deletion, before locking and revalidating the comment itself.
       */
      const [commentReference] = await tx
        .select({
          contentItemId: comments.contentItemId,
        })
        .from(comments)
        .where(eq(comments.id, commentId))
        .limit(1);

      if (!commentReference) {
        return null;
      }

      // Serialize reactions against publication changes and comment deletion.
      const [contentItem] = await tx
        .select({
          id: contentItems.id,
          status: contentItems.status,
        })
        .from(contentItems)
        .where(eq(contentItems.id, commentReference.contentItemId))
        .for("update")
        .limit(1);

      // New and changed reactions are allowed only on published content.
      if (!contentItem || contentItem.status !== "published") {
        return null;
      }

      /*
       * Re-read and lock the comment after acquiring the parent lock.
       * It may have been deleted while this transaction was waiting.
       */
      const [comment] = await tx
        .select({
          id: comments.id,
        })
        .from(comments)
        .where(
          and(
            eq(comments.id, commentId),
            eq(comments.contentItemId, contentItem.id),
          ),
        )
        .for("update")
        .limit(1);

      if (!comment) {
        return null;
      }

      const existing = await tx
        .select({
          reactionType: commentReactions.reactionType,
        })
        .from(commentReactions)
        .where(
          and(
            eq(commentReactions.commentId, commentId),
            eq(commentReactions.userId, userId),
          ),
        )
        .for("update")
        .limit(1);

      if (existing.length === 0) {
        const inserted = await tx
          .insert(commentReactions)
          .values({
            commentId,
            userId,
            reactionType,
          })
          .onConflictDoNothing({
            target: [commentReactions.commentId, commentReactions.userId],
          })
          .returning();

        if (inserted.length > 0) {
          await tx
            .update(comments)
            .set({
              reactionCount: sql`${comments.reactionCount} + 1`,
            })
            .where(eq(comments.id, commentId));

          return {
            previousReactionType: null,
            reaction: inserted[0],
          };
        }

        const [concurrentExisting] = await tx
          .select({
            reactionType: commentReactions.reactionType,
          })
          .from(commentReactions)
          .where(
            and(
              eq(commentReactions.commentId, commentId),
              eq(commentReactions.userId, userId),
            ),
          )
          .for("update")
          .limit(1);

        if (!concurrentExisting) {
          return null;
        }

        const previousReactionType = concurrentExisting.reactionType;

        if (previousReactionType === reactionType) {
          return {
            previousReactionType,
            reaction: concurrentExisting,
          };
        }

        const [updated] = await tx
          .update(commentReactions)
          .set({
            reactionType,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(commentReactions.commentId, commentId),
              eq(commentReactions.userId, userId),
            ),
          )
          .returning();

        return updated
          ? {
              previousReactionType,
              reaction: updated,
            }
          : null;
      }

      const previousReactionType = existing[0].reactionType;

      if (previousReactionType === reactionType) {
        return {
          previousReactionType,
          reaction: existing[0],
        };
      }

      const [updated] = await tx
        .update(commentReactions)
        .set({
          reactionType,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(commentReactions.commentId, commentId),
            eq(commentReactions.userId, userId),
          ),
        )
        .returning();

      return updated
        ? {
            previousReactionType,
            reaction: updated,
          }
        : null;
    });
  }

  /**
   * Remove a user's reaction from a comment.
   *
   * The counter is decremented only when an actual reaction is deleted.
   */
  public async deleteCommentReaction(
    commentId: string,
    userId: string,
    transaction?: DatabaseTransaction,
  ) {
    return this.withTransaction(transaction, async (tx) => {
      const [deleted] = await tx
        .delete(commentReactions)
        .where(
          and(
            eq(commentReactions.commentId, commentId),
            eq(commentReactions.userId, userId),
          ),
        )
        .returning();

      if (!deleted) {
        return null;
      }

      await tx
        .update(comments)
        .set({
          reactionCount: sql`GREATEST(${comments.reactionCount} - 1, 0)`,
        })
        .where(eq(comments.id, commentId));

      return deleted;
    });
  }

  /**
   * Return reaction counts grouped by reaction type for a comment.
   */
  public async getCommentReactionCounts(commentId: string) {
    return db
      .select({
        reactionType: commentReactions.reactionType,
        count: sql<number>`count(*)::int`,
      })
      .from(commentReactions)
      .where(eq(commentReactions.commentId, commentId))
      .groupBy(commentReactions.reactionType);
  }

  // ---------------------------------------------------------------------------
  // Backward-compatible Post method aliases
  // ---------------------------------------------------------------------------

  /**
   * @deprecated Use findContentItemReaction().
   */
  public async findPostReaction(postId: string, userId: string) {
    const reaction = await this.findContentItemReaction(postId, userId);

    if (!reaction) {
      return null;
    }

    return {
      postId: reaction.contentItemId,
      userId: reaction.userId,
      reactionType: reaction.reactionType,
    };
  }

  /**
   * @deprecated Use setContentItemReaction().
   */
  public async setPostReaction(
    postId: string,
    userId: string,
    reactionType: ReactionType,
    transaction?: DatabaseTransaction,
  ) {
    return this.setContentItemReaction(
      postId,
      userId,
      reactionType,
      transaction,
    );
  }

  /**
   * @deprecated Use deleteContentItemReaction().
   */
  public async deletePostReaction(
    postId: string,
    userId: string,
    transaction?: DatabaseTransaction,
  ) {
    return this.deleteContentItemReaction(postId, userId, transaction);
  }

  /**
   * @deprecated Use getContentItemReactionCounts().
   */
  public async getPostReactionCounts(postId: string) {
    return this.getContentItemReactionCounts(postId);
  }
}

export const reactionRepository = new ReactionRepository();
