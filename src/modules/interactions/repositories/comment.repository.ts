import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";

import { db, type DatabaseTransaction } from "../../../db";
import {
  articles,
  comments,
  commentReactions,
  contentItems,
  posts,
  users,
} from "../../../db/schema";

import type { CommentCursor } from "../interface/comment.interface";

type CreatedCommentRecord = Pick<
  typeof comments.$inferSelect,
  "id" | "contentItemId" | "authorId" | "parentCommentId" | "createdAt"
>;

export class CommentRepository {
  /**
   * Validates that the shared content item has its matching subtype row.
   * A valid content_items row alone is not enough: it must have either
   * a corresponding posts row or articles row.
   */
  async findContentItemForComment(contentItemId: string) {
    const [item] = await db
      .select({
        id: contentItems.id,
        authorId: contentItems.authorId,
        contentType: contentItems.contentType,
      })
      .from(contentItems)
      .where(eq(contentItems.id, contentItemId))
      .limit(1);

    if (!item) {
      return null;
    }

    if (item.contentType === "post") {
      const [post] = await db
        .select({ id: posts.id })
        .from(posts)
        .where(eq(posts.id, item.id))
        .limit(1);

      return post ? { id: item.id, authorId: item.authorId } : null;
    }

    if (item.contentType === "article") {
      const [article] = await db
        .select({ id: articles.id })
        .from(articles)
        .where(eq(articles.id, item.id))
        .limit(1);

      return article ? { id: item.id, authorId: item.authorId } : null;
    }

    return null;
  }

  /**
   * Legacy method name retained for existing callers.
   * The supplied ID now represents a shared content item.
   */
  async findPostForComment(contentItemId: string) {
    return this.findContentItemForComment(contentItemId);
  }

  /**
   * Creates a comment or reply.
   *
   * Important invariants are checked inside the transaction:
   * - The target content item exists.
   * - Its matching Post/Article subtype exists.
   * - A reply's parent belongs to the same content item.
   *
   * The content item's row lock serializes comment creation and deletion
   * for that item, keeping the denormalized comment counter consistent.
   */
  async createComment(
    contentItemId: string,
    authorId: string,
    content: string,
    parentCommentId?: string | null,
    transaction?: DatabaseTransaction,
  ): Promise<CreatedCommentRecord> {
    const create = async (tx: DatabaseTransaction) => {
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
        throw new AppError(HTTP_STATUS.NOT_FOUND, "Content not found");
      }

      // Social comments are allowed only after the content is published.
      // Return the same 404 as missing content to avoid exposing drafts.
      if (item.status !== "published") {
        throw new AppError(HTTP_STATUS.NOT_FOUND, "Content not found");
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
        throw new AppError(HTTP_STATUS.NOT_FOUND, "Content not found");
      }

      if (parentCommentId) {
        const [parent] = await tx
          .select({
            id: comments.id,
          })
          .from(comments)
          .where(
            and(
              eq(comments.id, parentCommentId),
              eq(comments.contentItemId, contentItemId),
            ),
          )
          .for("update")
          .limit(1);

        if (!parent) {
          throw new AppError(
            HTTP_STATUS.BAD_REQUEST,
            "Parent comment does not belong to this content item",
          );
        }
      }

      const [created] = await tx
        .insert(comments)
        .values({
          content,
          contentItemId,
          authorId,
          parentCommentId: parentCommentId ?? null,
        })
        .returning({
          id: comments.id,
          contentItemId: comments.contentItemId,
          authorId: comments.authorId,
          parentCommentId: comments.parentCommentId,
          createdAt: comments.createdAt,
        });

      if (!created) {
        throw new AppError(
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          "Failed to create comment",
        );
      }

      await tx
        .update(contentItems)
        .set({
          commentCount: sql`${contentItems.commentCount} + 1`,
        })
        .where(eq(contentItems.id, contentItemId));

      if (parentCommentId) {
        await tx
          .update(comments)
          .set({
            replyCount: sql`${comments.replyCount} + 1`,
          })
          .where(eq(comments.id, parentCommentId));
      }

      // Return the inserted comment to the caller.
      return created;
    };

    // Reuse the caller's transaction when supplied; otherwise create one.
    return transaction ? create(transaction) : db.transaction(create);
  }

  async getTopLevelComments(
    contentItemId: string,
    limit: number,
    cursor?: CommentCursor,
    requesterId?: string,
  ) {
    const conditions = [
      eq(comments.contentItemId, contentItemId),
      isNull(comments.parentCommentId),
      eq(contentItems.status, "published"),
    ];

    if (cursor) {
      conditions.push(sql`(
        ${comments.createdAt} < ${cursor.createdAt}::timestamptz
        OR (
          ${comments.createdAt} = ${cursor.createdAt}::timestamptz
          AND ${comments.id} < ${cursor.id}::uuid
        )
      )`);
    }

    return db
      .select({
        id: comments.id,
        content: comments.content,
        parentCommentId: comments.parentCommentId,
        replyCount: comments.replyCount,
        isEdited: comments.isEdited,

        // Keep the current API field name for compatibility.
        likeCount: comments.reactionCount,

        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,

        cursorCreatedAt: sql<string>`
          to_char(
            ${comments.createdAt} AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          )
        `,

        author: {
          id: users.id,
          username: users.username,
          fullname: users.fullname,
          profileImageUrl: users.profileImageUrl,
        },

        ...(requesterId
          ? {
              reactionType: sql<string | null>`(
                SELECT ${commentReactions.reactionType}
                FROM ${commentReactions}
                WHERE ${commentReactions.commentId} = ${comments.id}
                  AND ${commentReactions.userId} = ${requesterId}
                LIMIT 1
              )`.mapWith(String),
            }
          : {}),
      })
      .from(comments)
      .innerJoin(contentItems, eq(comments.contentItemId, contentItems.id))
      .innerJoin(users, eq(comments.authorId, users.id))
      .where(and(...conditions))
      .orderBy(desc(comments.createdAt), desc(comments.id))
      .limit(limit);
  }

  async getCommentReplies(
    parentCommentId: string,
    limit: number,
    cursor?: CommentCursor,
    requesterId?: string,
  ) {
    const conditions = [
      eq(comments.parentCommentId, parentCommentId),
      eq(contentItems.status, "published"),
    ];

    if (cursor) {
      conditions.push(sql`(
        ${comments.createdAt} < ${cursor.createdAt}::timestamptz
        OR (
          ${comments.createdAt} = ${cursor.createdAt}::timestamptz
          AND ${comments.id} < ${cursor.id}::uuid
        )
      )`);
    }

    return db
      .select({
        id: comments.id,
        content: comments.content,
        parentCommentId: comments.parentCommentId,
        replyCount: comments.replyCount,
        isEdited: comments.isEdited,

        // Keep the current API field name for compatibility.
        likeCount: comments.reactionCount,

        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,

        cursorCreatedAt: sql<string>`
          to_char(
            ${comments.createdAt} AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          )
        `,

        author: {
          id: users.id,
          username: users.username,
          fullname: users.fullname,
          profileImageUrl: users.profileImageUrl,
        },

        ...(requesterId
          ? {
              reactionType: sql<string | null>`(
                SELECT ${commentReactions.reactionType}
                FROM ${commentReactions}
                WHERE ${commentReactions.commentId} = ${comments.id}
                  AND ${commentReactions.userId} = ${requesterId}
                LIMIT 1
              )`.mapWith(String),
            }
          : {}),
      })
      .from(comments)
      .innerJoin(contentItems, eq(comments.contentItemId, contentItems.id))
      .innerJoin(users, eq(comments.authorId, users.id))
      .where(and(...conditions))
      .orderBy(desc(comments.createdAt), desc(comments.id))
      .limit(limit);
  }

  /**
   * Shared comment lookup.
   *
   * Public reads require published content. Management operations can
   * inspect an existing comment even if its content is unpublished, so
   * its author can still manage their comment.
   */
  private async findCommentById(
    commentId: string,
    requesterId: string | undefined,
    requirePublished: boolean,
  ) {
    const conditions = [eq(comments.id, commentId)];

    if (requirePublished) {
      conditions.push(eq(contentItems.status, "published"));
    }

    const result = await db
      .select({
        id: comments.id,
        content: comments.content,
        contentItemId: comments.contentItemId,

        // Legacy API response alias. Prefer contentItemId in new clients.
        postId: comments.contentItemId,

        authorId: comments.authorId,
        parentCommentId: comments.parentCommentId,
        replyCount: comments.replyCount,
        isEdited: comments.isEdited,
        likeCount: comments.reactionCount,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,

        author: {
          id: users.id,
          username: users.username,
          fullname: users.fullname,
          profileImageUrl: users.profileImageUrl,
        },

        ...(requesterId
          ? {
              reactionType: sql<string | null>`(
                SELECT ${commentReactions.reactionType}
                FROM ${commentReactions}
                WHERE ${commentReactions.commentId} = ${comments.id}
                  AND ${commentReactions.userId} = ${requesterId}
                LIMIT 1
              )`.mapWith(String),
            }
          : {}),
      })
      .from(comments)
      .innerJoin(contentItems, eq(comments.contentItemId, contentItems.id))
      .innerJoin(users, eq(comments.authorId, users.id))
      .where(and(...conditions))
      .limit(1);

    return result[0] ?? null;
  }

  /** Retrieve a comment only when its parent content is published. */
  public async getCommentById(commentId: string, requesterId?: string) {
    return this.findCommentById(commentId, requesterId, true);
  }

  /**
   * Internal lookup for ownership checks and comment management.
   * This method is not used by the public comment-reading endpoints.
   */
  public async getCommentByIdForManagement(
    commentId: string,
    requesterId?: string,
  ) {
    return this.findCommentById(commentId, requesterId, false);
  }

  /**
   * Deletes a comment and its replies through the FK cascade.
   *
   * The content item row is locked before deletion and recounting, so
   * concurrent comment creation/deletion cannot leave commentCount stale.
   */
  async deleteComment(commentId: string) {
    return db.transaction(async (tx) => {
      const [candidate] = await tx
        .select({
          id: comments.id,
          contentItemId: comments.contentItemId,
        })
        .from(comments)
        .where(eq(comments.id, commentId))
        .limit(1);

      if (!candidate) {
        return null;
      }

      const [item] = await tx
        .select({
          id: contentItems.id,
        })
        .from(contentItems)
        .where(eq(contentItems.id, candidate.contentItemId))
        .for("update")
        .limit(1);

      if (!item) {
        return null;
      }

      // Re-read after acquiring the content item lock. Another deletion
      // may have removed this comment while this transaction was waiting.
      const [comment] = await tx
        .select({
          id: comments.id,
          contentItemId: comments.contentItemId,
          parentCommentId: comments.parentCommentId,
        })
        .from(comments)
        .where(eq(comments.id, commentId))
        .for("update")
        .limit(1);

      if (!comment) {
        return null;
      }

      const [deleted] = await tx
        .delete(comments)
        .where(eq(comments.id, commentId))
        .returning({
          id: comments.id,
          contentItemId: comments.contentItemId,
          parentCommentId: comments.parentCommentId,
        });

      if (!deleted) {
        return null;
      }

      // The FK cascade has already removed nested replies.
      await tx
        .update(contentItems)
        .set({
          commentCount: sql`(
            SELECT COUNT(*)::int
            FROM ${comments}
            WHERE ${comments.contentItemId} = ${comment.contentItemId}
          )`,
        })
        .where(eq(contentItems.id, comment.contentItemId));

      if (comment.parentCommentId) {
        await tx
          .update(comments)
          .set({
            replyCount: sql`(
              SELECT COUNT(*)::int
              FROM ${comments} AS child_comments
              WHERE child_comments.parent_comment_id = ${comment.parentCommentId}
            )`,
          })
          .where(eq(comments.id, comment.parentCommentId));
      }

      return deleted;
    });
  }

  async updateComment(commentId: string, content: string) {
    const result = await db
      .update(comments)
      .set({
        content,
        isEdited: true,
      })
      .where(eq(comments.id, commentId))
      .returning({
        id: comments.id,
      });

    return result[0] ?? null;
  }
}

export const commentRepository = new CommentRepository();
