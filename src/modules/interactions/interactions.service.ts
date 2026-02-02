import { eq, and, desc, sql, count, isNull } from "drizzle-orm";
import { db } from "../../db";
import { comments, shares, posts, users } from "../../db/schema";
import { Comment } from "../../db/schema";
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

    let comment: Comment;
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
        .returning();

      comment = created;

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
    }

    if (post.authorId !== userId) {
      await addInteractionJob({
        type: NotificationType.COMMENT,
        recipientId: post.authorId,
        actorId: userId,
        relatedId: postId,
        message: "commented on your post",
      });
    }

    const [commentWithAuthor] = await db
      .select({
        comment: comments,
        authorUsername: users.username,
        authorProfileImage: users.profileImageUrl,
      })
      .from(comments)
      .leftJoin(users, eq(comments.authorId, users.id))
      .where(eq(comments.id, comment!.id))
      .limit(1);

    return {
      ...commentWithAuthor.comment,
      author: {
        username: commentWithAuthor.authorUsername,
        profileImageUrl: commentWithAuthor.authorProfileImage,
      },
    };
  }

  public async getPostComments(
    postId: string,
    page: number = 1,
    limit: number = 20,
    parentId: string | null = null,
  ) {
    const offset = (page - 1) * limit;

    const conditions = parentId
      ? and(eq(comments.postId, postId), eq(comments.parentCommentId, parentId))
      : and(eq(comments.postId, postId), isNull(comments.parentCommentId));

    const results = await db
      .select({
        comment: comments,
        authorUsername: users.username,
        authorProfileImage: users.profileImageUrl,
      })
      .from(comments)
      .leftJoin(users, eq(comments.authorId, users.id))
      .where(conditions)
      .orderBy(desc(comments.createdAt))
      .offset(offset)
      .limit(limit);

    return results.map(
      ({ comment: c, authorUsername, authorProfileImage }) => ({
        ...c,
        author: {
          username: authorUsername,
          profileImageUrl: authorProfileImage,
        },
      }),
    );
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
      throw new AppError(
        HTTP_STATUS.FORBIDDEN,
        "Not authorized to delete this comment",
      );
    }

    await db.transaction(async (tx) => {
      const [replyCountResult] = await tx
        .select({ total: count() })
        .from(comments)
        .where(eq(comments.parentCommentId, commentId));

      const replyCount = replyCountResult.total;

      await tx.delete(comments).where(eq(comments.parentCommentId, commentId));

      await tx.delete(comments).where(eq(comments.id, commentId));

      const totalRemoved = 1 + replyCount;
      await tx
        .update(posts)
        .set({ commentCount: sql`${posts.commentCount} - ${totalRemoved}` })
        .where(eq(posts.id, comment.postId));

      if (comment.parentCommentId) {
        await tx
          .update(comments)
          .set({ replyCount: sql`${comments.replyCount} - 1` })
          .where(eq(comments.id, comment.parentCommentId));
      }
    });
  }

  public async logShare(
    userId: string,
    postId: string,
    platform: string,
  ): Promise<void> {
    await db.insert(shares).values({
      userId,
      postId,
      platform,
    });
  }
}

export const interactionsService = new InteractionsService();
