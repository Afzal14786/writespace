import { eq, and, desc, sql, isNull, lt } from "drizzle-orm";
import { db } from "../../db";
import { comments, shares, posts, users } from "../../db/schema";
import { commentLikes } from "../../db/schema/comment-likes"; 
import { AddCommentDto } from "./dtos/add-comment.dto";
import { AppError } from "../../shared/utils/app.error";
import { HTTP_STATUS } from "../../shared/constants/http-codes";
import { addInteractionJob } from "../../shared/queues/interaction.queue";
import { NotificationType } from "../../modules/notification/interface/notification.interface";

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
      await addInteractionJob({
        type: NotificationType.COMMENT,
        recipientId: parentCommentAuthor,
        actorId: userId,
        relatedId: postId,
        message: "replied to your comment",
      });
    } else if (post.authorId !== userId) {
      await addInteractionJob({
        type: NotificationType.COMMENT,
        recipientId: post.authorId,
        actorId: userId,
        relatedId: postId,
        message: "commented on your post",
      });
    }

    // Instantly return hydrated comment for optimistic UI
    return await this.getCommentById(newCommentId!, userId);
  }

  // 🔥 1. Fetch Top Level Comments Only (Cursor Pagination)
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

  // 🔥 2. Fetch Replies On Demand (Lazy Loading)
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

  // 🔥 3. The New Like Comment Logic
  public async likeComment(commentId: string, userId: string): Promise<{ status: "liked" | "unliked" }> {
    let resultStatus: "liked" | "unliked";

    await db.transaction(async (tx) => {
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
      // 1. Delete the comment (PostgreSQL ON DELETE CASCADE will automatically delete all deeply nested replies)
      await tx.delete(comments).where(eq(comments.id, commentId));
      await tx.execute(
        sql`UPDATE posts SET comment_count = (SELECT COUNT(*) FROM comments WHERE post_id = ${comment.postId}) WHERE id = ${comment.postId}`
      );

      // 3. Update the direct parent's reply count (if this was a reply)
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
    // 1. Find the comment
    const [comment] = await db
      .select()
      .from(comments)
      .where(eq(comments.id, commentId))
      .limit(1);

    if (!comment) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Comment not found");
    }

    // 2. SECURITY CHECK: Ensure the requester is the author
    if (comment.authorId !== userId) {
      throw new AppError(
        HTTP_STATUS.FORBIDDEN,
        "You are not authorized to edit this comment"
      );
    }

    // 3. Update the comment and set isEdited to true
    await db
      .update(comments)
      .set({ content, isEdited: true })
      .where(eq(comments.id, commentId));

    // 4. Return the fully hydrated comment so the UI updates instantly
    return await this.getCommentById(commentId, userId);
  }

  
  public async logShare(userId: string, postId: string, platform: string): Promise<void> {
    await db.insert(shares).values({ userId, postId, platform });
  }
}

export const interactionsService = new InteractionsService();