import env from "@config/env";
import { db } from "../../../db";
import { eventPublisherService } from "@modules/notification/services/event-publisher.service";

import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";

import { commentRepository } from "../repositories/comment.repository";
import type { CommentCursor } from "../interface/comment.interface";

export class CommentService {
  async createComment(
    userId: string,
    contentItemId: string,
    content: string,
    parentCommentId?: string | null,
  ) {
    const contentItem =
      await commentRepository.findContentItemForComment(contentItemId);

    if (!contentItem) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Content not found");
    }

    if (parentCommentId) {
      const parentComment =
        await commentRepository.getCommentById(parentCommentId);

      if (!parentComment) {
        throw new AppError(HTTP_STATUS.NOT_FOUND, "Parent comment not found");
      }

      if (parentComment.contentItemId !== contentItemId) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "Parent comment does not belong to this content item",
        );
      }
    }

    const comment = await db.transaction(async (transaction) => {
      const createdComment = await commentRepository.createComment(
        contentItemId,
        userId,
        content,
        parentCommentId,
        transaction,
      );

      /*
       * Record the appropriate domain event in the same transaction as
       * the comment and counter updates.
       *
       * Top-level comments and replies have separate event contracts so
       * notification recipients can be resolved correctly.
       */
      if (env.OUTBOX_PROCESSING_ENABLED) {
        if (parentCommentId) {
          await eventPublisherService.recordInTransaction(transaction, {
            eventName: "comment.replied",
            eventVersion: 1,
            producer: "interactions.comments",

            aggregate: {
              type: "comment",
              id: createdComment.id,
            },

            actorId: userId,

            payload: {
              contentItemId,
              commentId: createdComment.id,
              parentCommentId,
            },
          });
        } else {
          await eventPublisherService.recordInTransaction(transaction, {
            eventName: "comment.created",
            eventVersion: 1,
            producer: "interactions.comments",

            aggregate: {
              type: "comment",
              id: createdComment.id,
            },

            actorId: userId,

            payload: {
              contentItemId,
              commentId: createdComment.id,
            },
          });
        }
      }

      return createdComment;
    });

    if (!comment) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Failed to create comment",
      );
    }

    const createdComment = await commentRepository.getCommentById(
      comment.id,
      userId,
    );

    if (!createdComment) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Failed to fetch created comment",
      );
    }

    return createdComment;
  }

  /**
   * Retrieves top-level comments using cursor-based pagination.
   *
   * One additional record is fetched to determine whether another
   * page exists. The extra record is not included in the response.
   */
  async getTopLevelComments(
    contentItemId: string,
    limit: number = 20,
    cursor?: string,
    requesterId?: string,
  ) {
    this.validateLimit(limit);

    const parsedCursor = this.parseCursor(cursor);

    const fetchedComments = await commentRepository.getTopLevelComments(
      contentItemId,
      limit + 1,
      parsedCursor,
      requesterId,
    );

    const hasMore = fetchedComments.length > limit;
    const pageComments = fetchedComments.slice(0, limit);
    const lastComment = pageComments[pageComments.length - 1];

    const nextCursor =
      hasMore && lastComment
        ? this.encodeCursor({
            createdAt: lastComment.cursorCreatedAt,
            id: lastComment.id,
          })
        : null;

    return {
      comments: pageComments.map(
        ({ cursorCreatedAt: _cursorCreatedAt, ...comment }) => ({
          ...comment,
          isReacted: Boolean(comment.reactionType),
          reactionType: comment.reactionType ?? null,
        }),
      ),
      nextCursor,
    };
  }

  /**
   * Retrieves direct replies to a comment using the same stable
   * cursor-pagination strategy as top-level comments.
   *
   * This method can be called for any comment, allowing nested
   * replies to be loaded recursively.
   */
  async getCommentReplies(
    parentCommentId: string,
    limit: number = 20,
    cursor?: string,
    requesterId?: string,
  ) {
    this.validateLimit(limit);

    const parentComment =
      await commentRepository.getCommentById(parentCommentId);

    if (!parentComment) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Comment not found");
    }

    const parsedCursor = this.parseCursor(cursor);

    const fetchedReplies = await commentRepository.getCommentReplies(
      parentCommentId,
      limit + 1,
      parsedCursor,
      requesterId,
    );

    const hasMore = fetchedReplies.length > limit;
    const pageReplies = fetchedReplies.slice(0, limit);
    const lastReply = pageReplies[pageReplies.length - 1];

    const nextCursor =
      hasMore && lastReply
        ? this.encodeCursor({
            createdAt: lastReply.cursorCreatedAt,
            id: lastReply.id,
          })
        : null;

    return {
      replies: pageReplies.map(
        ({ cursorCreatedAt: _cursorCreatedAt, ...reply }) => ({
          ...reply,
          isReacted: Boolean(reply.reactionType),
          reactionType: reply.reactionType ?? null,
        }),
      ),
      nextCursor,
    };
  }

  async getCommentById(commentId: string, requesterId?: string) {
    const comment = await commentRepository.getCommentById(
      commentId,
      requesterId,
    );

    if (!comment) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Comment not found");
    }

    return {
      ...comment,
      isReacted: Boolean(comment.reactionType),
      reactionType: comment.reactionType ?? null,
    };
  }

  async updateComment(userId: string, commentId: string, content: string) {
    const normalizedContent = content.trim();

    if (!normalizedContent) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Comment content cannot be empty",
      );
    }

    const comment =
      await commentRepository.getCommentByIdForManagement(commentId);

    if (!comment) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Comment not found");
    }

    if (comment.authorId !== userId) {
      throw new AppError(
        HTTP_STATUS.FORBIDDEN,
        "You are not authorized to edit this comment",
      );
    }

    const updated = await commentRepository.updateComment(
      commentId,
      normalizedContent,
    );

    if (!updated) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Failed to update comment",
      );
    }

    const updatedComment = await commentRepository.getCommentByIdForManagement(
      commentId,
      userId,
    );

    if (!updatedComment) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Failed to fetch updated comment",
      );
    }

    return {
      ...updatedComment,
      isReacted: Boolean(updatedComment.reactionType),
      reactionType: updatedComment.reactionType ?? null,
    };
  }

  async deleteComment(
    userId: string,
    commentId: string,
    isAdmin: boolean = false,
  ): Promise<void> {
    const comment =
      await commentRepository.getCommentByIdForManagement(commentId);

    if (!comment) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Comment not found");
    }

    if (comment.authorId !== userId && !isAdmin) {
      throw new AppError(
        HTTP_STATUS.FORBIDDEN,
        "Not authorized to delete this comment",
      );
    }

    const deleted = await commentRepository.deleteComment(commentId);

    if (!deleted) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Failed to delete comment",
      );
    }
  }

  /**
   * Keeps the pagination input within a valid range.
   *
   * The default page size remains 20. A maximum of 100 prevents
   * a client from requesting an unnecessarily large result set.
   */
  private validateLimit(limit: number): void {
    if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Limit must be an integer between 1 and 100",
      );
    }
  }

  /**
   * Encodes the last returned comment's position into an opaque cursor.
   * The frontend should pass this token back without modifying it.
   */
  private encodeCursor(cursor: CommentCursor): string {
    return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
  }

  /**
   * Decodes and validates a cursor received from the client.
   *
   * The timestamp remains a string so PostgreSQL's microsecond
   * precision is preserved when the next-page query is executed.
   */
  private parseCursor(cursor?: string): CommentCursor | undefined {
    if (!cursor) {
      return undefined;
    }

    try {
      if (cursor.length > 512) {
        throw new Error("Cursor is too long");
      }

      const decoded = Buffer.from(cursor, "base64url").toString("utf8");
      const parsed: unknown = JSON.parse(decoded);

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("createdAt" in parsed) ||
        !("id" in parsed)
      ) {
        throw new Error("Invalid cursor structure");
      }

      const { createdAt, id } = parsed;

      const validTimestamp =
        typeof createdAt === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(createdAt) &&
        !Number.isNaN(Date.parse(createdAt));

      const validId =
        typeof id === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        );

      if (!validTimestamp || !validId) {
        throw new Error("Invalid cursor values");
      }

      return { createdAt, id };
    } catch {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid cursor");
    }
  }
}

export const commentService = new CommentService();
