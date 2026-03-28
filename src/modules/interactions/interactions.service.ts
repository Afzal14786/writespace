import { eq, and, desc, sql, isNull, lt } from "drizzle-orm";
import { db } from "../../db";
import { comments, shares, posts, users, likes } from "../../db/schema";
import { commentLikes } from "../../db/schema/comment-likes"; 
import { AddCommentDto } from "./dtos/add-comment.dto";
import { AppError } from "../../shared/utils/app.error";
import { HTTP_STATUS } from "../../shared/constants/http-codes";
import { addInteractionJob } from "../../shared/queues/interaction.queue";
import { NotificationType } from "../../modules/notification/interface/notification.interface";
import { notificationService } from "../notification/notification.service";
import logger from "../../config/logger";

class InteractionsService {
  public async createComment(
    userId: string,
    postId: string,
    data: AddCommentDto,
  ) {
    const [post] = await db
      .select({ id: posts.id, authorId: posts.authorId })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);

    if (!post) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    let newCommentId: string;
    let parentCommentAuthor: string | null = null;

    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(comments)
        .values({
          content: data.content,
          postId,
          authorId: userId,
          parentCommentId: data.parentCommentId || null,
        })
        .returning({ id: comments.id });

      newCommentId = created.id;

      await tx
        .update(posts)
        .set({ commentCount: sql`${posts.commentCount} + 1` })
        .where(eq(posts.id, postId));

      if (data.parentCommentId) {
        const [parentComment] = await tx
          .update(comments)
          .set({ replyCount: sql`${comments.replyCount} + 1` })
          .where(eq(comments.id, data.parentCommentId))
          .returning({ authorId: comments.authorId });

        if (parentComment && parentComment.authorId !== userId) {
          parentCommentAuthor = parentComment.authorId;
        }
      }
    });

    if (parentCommentAuthor) {
      addInteractionJob({
        type: NotificationType.COMMENT,
        recipientId: parentCommentAuthor,
        actorId: userId,
        relatedId: postId,
        message: "replied to your comment",
      }).catch((err: unknown) => logger.error("Failed to queue reply notification", { error: err instanceof Error ? err.message : String(err) }));
    } else if (post.authorId !== userId) {
      addInteractionJob({
        type: NotificationType.COMMENT,
        recipientId: post.authorId,
        actorId: userId,
        relatedId: postId,
        message: "commented on your post",
      }).catch((err: unknown) => logger.error("Failed to queue comment notification", { error: err instanceof Error ? err.message : String(err) }));
    }

    return await this.getCommentById(newCommentId!, userId);
  }

  public async getTopLevelComments(
    postId: string,
    limit: number = 20,
    cursor?: string,
    requesterId?: string
  ) {
    const conditions = [
      eq(comments.postId, postId),
      isNull(comments.parentCommentId)
    ];

    if (cursor) {
      conditions.push(lt(comments.createdAt, new Date(cursor)));
    }

    const results = await db
      .select({
        id: comments.id,
        content: comments.content,
        parentCommentId: comments.parentCommentId,
        likeCount: comments.likeCount,
        replyCount: comments.replyCount,
        isEdited: comments.isEdited,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
        author: {
          id: users.id,
          username: users.username,
          fullname: users.fullname,
          profileImageUrl: users.profileImageUrl,
        },
        ...(requesterId ? {
          isLikedByMe: sql<boolean>`exists(select 1 from ${commentLikes} where ${commentLikes.commentId} = ${comments.id} and ${commentLikes.userId} = ${requesterId})`.mapWith(Boolean)
        } : {})
      })
      .from(comments)
      .innerJoin(users, eq(comments.authorId, users.id))
      .where(and(...conditions))
      .orderBy(desc(comments.createdAt))
      .limit(limit);

    let nextCursor: string | null = null;
    if (results.length === limit) {
      const lastComment = results[results.length - 1];
      if (lastComment.createdAt) {
        nextCursor = lastComment.createdAt.toISOString();
      }
    }

    const formattedComments = results.map((row) => ({
      ...row,
      isLikedByMe: 'isLikedByMe' in row ? !!row.isLikedByMe : false,
    }));

    return { comments: formattedComments, nextCursor };
  }

  public async getCommentReplies(
    parentCommentId: string,
    limit: number = 20,
    cursor?: string,
    requesterId?: string
  ) {
    const conditions = [
      eq(comments.parentCommentId, parentCommentId)
    ];

    if (cursor) {
      conditions.push(lt(comments.createdAt, new Date(cursor)));
    }

    const results = await db
      .select({
        id: comments.id,
        content: comments.content,
        parentCommentId: comments.parentCommentId,
        likeCount: comments.likeCount,
        replyCount: comments.replyCount,
        isEdited: comments.isEdited,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
        author: {
          id: users.id,
          username: users.username,
          fullname: users.fullname,
          profileImageUrl: users.profileImageUrl,
        },
        ...(requesterId ? {
          isLikedByMe: sql<boolean>`exists(select 1 from ${commentLikes} where ${commentLikes.commentId} = ${comments.id} and ${commentLikes.userId} = ${requesterId})`.mapWith(Boolean)
        } : {})
      })
      .from(comments)
      .innerJoin(users, eq(comments.authorId, users.id))
      .where(and(...conditions))
      .orderBy(desc(comments.createdAt)) 
      .limit(limit);

    let nextCursor: string | null = null;
    if (results.length === limit) {
      const lastComment = results[results.length - 1];
      if (lastComment.createdAt) {
        nextCursor = lastComment.createdAt.toISOString();
      }
    }

    const formattedComments = results.map((row) => ({
      ...row,
      isLikedByMe: 'isLikedByMe' in row ? !!row.isLikedByMe : false,
    }));

    return { replies: formattedComments, nextCursor };
  }

  private async getCommentById(commentId: string, requesterId?: string) {
    const [comment] = await db
      .select({
        id: comments.id,
        content: comments.content,
        parentCommentId: comments.parentCommentId,
        likeCount: comments.likeCount,
        replyCount: comments.replyCount,
        isEdited: comments.isEdited,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
        author: {
          id: users.id,
          username: users.username,
          fullname: users.fullname,
          profileImageUrl: users.profileImageUrl,
        },
        ...(requesterId ? {
          isLikedByMe: sql<boolean>`exists(select 1 from ${commentLikes} where ${commentLikes.commentId} = ${comments.id} and ${commentLikes.userId} = ${requesterId})`.mapWith(Boolean)
        } : {})
      })
      .from(comments)
      .innerJoin(users, eq(comments.authorId, users.id))
      .where(eq(comments.id, commentId))
      .limit(1);

    return {
      ...comment,
      isLikedByMe: 'isLikedByMe' in comment ? !!comment.isLikedByMe : false,
    };
  }

  public async likeComment(commentId: string, userId: string): Promise<{ status: "liked" | "unliked" }> {
    let resultStatus: "liked" | "unliked";
    let commentAuthorId: string | null = null;
    let relatedPostId: string | null = null;

    await db.transaction(async (tx) => {
      const [comment] = await tx
        .select({ authorId: comments.authorId, postId: comments.postId })
        .from(comments)
        .where(eq(comments.id, commentId))
        .limit(1);

      if (comment) {
        commentAuthorId = comment.authorId;
        relatedPostId = comment.postId;
      }

      const [existingLike] = await tx
        .select()
        .from(commentLikes)
        .where(and(eq(commentLikes.commentId, commentId), eq(commentLikes.userId, userId)))
        .limit(1);

      if (existingLike) {
        await tx.delete(commentLikes).where(and(eq(commentLikes.commentId, commentId), eq(commentLikes.userId, userId)));
        await tx.update(comments).set({ likeCount: sql`${comments.likeCount} - 1` }).where(eq(comments.id, commentId));
        resultStatus = "unliked";
      } else {
        await tx.insert(commentLikes).values({ commentId, userId });
        await tx.update(comments).set({ likeCount: sql`${comments.likeCount} + 1` }).where(eq(comments.id, commentId));
        resultStatus = "liked";
      }
    });

    if (resultStatus! === "liked" && commentAuthorId && commentAuthorId !== userId && relatedPostId) {
      addInteractionJob({
        type: NotificationType.LIKE,
        recipientId: commentAuthorId,
        actorId: userId,
        relatedId: relatedPostId,
        message: "liked your comment.",
      }).catch((err: unknown) => logger.error("Failed to queue comment like notification", { error: err instanceof Error ? err.message : String(err) }));
    }

    return { status: resultStatus! };
  }

  public async toggleLikePost(postId: string, userId: string): Promise<{ status: "liked" | "unliked" }> {
    let resultStatus: "liked" | "unliked";
    let postAuthorId: string | null = null;

    await db.transaction(async (tx) => {
      const [post] = await tx
        .select({ authorId: posts.authorId })
        .from(posts)
        .where(eq(posts.id, postId))
        .limit(1);

      if (!post) {
        throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
      }
      
      postAuthorId = post.authorId;

      const [existingLike] = await tx
        .select()
        .from(likes)
        .where(and(eq(likes.postId, postId), eq(likes.userId, userId)))
        .limit(1);

      if (existingLike) {
        await tx.delete(likes).where(and(eq(likes.postId, postId), eq(likes.userId, userId)));
        await tx.update(posts).set({ likeCount: sql`${posts.likeCount} - 1` }).where(eq(posts.id, postId));
        resultStatus = "unliked";
      } else {
        await tx.insert(likes).values({ postId, userId });
        await tx.update(posts).set({ likeCount: sql`${posts.likeCount} + 1` }).where(eq(posts.id, postId));
        resultStatus = "liked";
      }
    });

    // Notify the author if it's a new like
    if (resultStatus! === "liked" && postAuthorId && postAuthorId !== userId) {
      notificationService.sendLikeNotification(postAuthorId, userId, postId)
        .catch((err: unknown) => logger.error("Failed to queue post like notification", { error: err instanceof Error ? err.message : String(err) }));
    }

    return { status: resultStatus! };
  }

  public async deleteComment(
    userId: string,
    commentId: string,
    isAdmin: boolean = false,
  ): Promise<void> {
    const [comment] = await db
      .select()
      .from(comments)
      .where(eq(comments.id, commentId))
      .limit(1);

    if (!comment) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Comment not found");
    }

    if (comment.authorId !== userId && !isAdmin) {
      throw new AppError(HTTP_STATUS.FORBIDDEN, "Not authorized to delete this comment");
    }

    await db.transaction(async (tx) => {
      await tx.delete(comments).where(eq(comments.id, commentId));
      await tx.execute(
        sql`UPDATE posts SET comment_count = (SELECT COUNT(*) FROM comments WHERE post_id = ${comment.postId}) WHERE id = ${comment.postId}`
      );

      if (comment.parentCommentId) {
        await tx.execute(
          sql`UPDATE comments SET reply_count = (SELECT COUNT(*) FROM comments WHERE parent_comment_id = ${comment.parentCommentId}) WHERE id = ${comment.parentCommentId}`
        );
      }
    });
  }

  public async updateComment(
    userId: string,
    commentId: string,
    content: string
  ) {
    const [comment] = await db
      .select()
      .from(comments)
      .where(eq(comments.id, commentId))
      .limit(1);

    if (!comment) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Comment not found");
    }

    if (comment.authorId !== userId) {
      throw new AppError(
        HTTP_STATUS.FORBIDDEN,
        "You are not authorized to edit this comment"
      );
    }

    await db
      .update(comments)
      .set({ content, isEdited: true })
      .where(eq(comments.id, commentId));

    return await this.getCommentById(commentId, userId);
  }

  public async logShare(userId: string, postId: string, platform: string): Promise<void> {
    await db.insert(shares).values({ userId, postId, platform });

    const [post] = await db
      .select({ authorId: posts.authorId })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);

    if (post && post.authorId !== userId) {
      notificationService.sendShareNotification(post.authorId, userId, postId)
        .catch((err: unknown) => logger.error("Failed to queue share notification", { error: err instanceof Error ? err.message : String(err) }));
    }
  }
}

export const interactionsService = new InteractionsService();