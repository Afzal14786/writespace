import { CommentModel } from "./comments.model";
import { ShareModel } from "./shares.model";
import { PostModel } from "../posts/posts.model";
import { AddCommentDto } from "./dtos/add-comment.dto";
import { AppError } from "../../shared/utils/app.error";
import { HTTP_STATUS } from "../../shared/constants/http-codes";
import { IComment } from "./interface/comment.interface";
import { addInteractionJob } from "../../shared/queues/interaction.queue";
import { NotificationType } from "../../modules/notification/interface/notification.interface";

class InteractionsService {
  /**
   * Add a comment to a post.
   */
  public async createComment(
    userId: string,
    postId: string,
    data: AddCommentDto,
  ): Promise<IComment> {
    const post = await PostModel.findById(postId);
    if (!post) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    const comment = await CommentModel.create({
      content: data.content,
      post: postId,
      author: userId,
      parentComment: data.parentCommentId || undefined,
    });

    // Update post comment count
    await PostModel.findByIdAndUpdate(postId, {
      $inc: { "stats.commentCount": 1 },
    });

    // If it's a reply, update parent's reply count
    if (data.parentCommentId) {
      const parentComment = await CommentModel.findByIdAndUpdate(
        data.parentCommentId,
        { $inc: { "stats.replyCount": 1 } },
      );

      // Notify parent comment author
      if (parentComment && parentComment.author.toString() !== userId) {
        await addInteractionJob({
          type: NotificationType.COMMENT,
          recipientId: parentComment.author.toString(),
          actorId: userId,
          relatedId: postId,
          message: "replied to your comment",
        });
      }
    }

    // Notify post author
    if (post.author.toString() !== userId) {
      await addInteractionJob({
        type: NotificationType.COMMENT,
        recipientId: post.author.toString(),
        actorId: userId,
        relatedId: postId,
        message: "commented on your post",
      });
    }

    return comment.populate(
      "author",
      "personal_info.username personal_info.profile_image",
    );
  }

  /**
   * Get comments for a post.
   * Supports pagination and getting replies for a specific parent if needed (logic can be expanded).
   * For now, fetches top-level comments.
   */
  public async getPostComments(
    postId: string,
    page: number = 1,
    limit: number = 20,
    parentId: string | null = null,
  ): Promise<IComment[]> {
    const skip = (page - 1) * limit;
    const query: any = { post: postId, parentComment: parentId };

    return CommentModel.find(query)
      .populate("author", "personal_info.username personal_info.profile_image")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
  }

  /**
   * Delete a comment (Author or Admin).
   */
  public async deleteComment(
    userId: string,
    commentId: string,
    isAdmin: boolean = false,
  ): Promise<void> {
    const comment = await CommentModel.findById(commentId);
    if (!comment) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Comment not found");
    }

    if (comment.author.toString() !== userId && !isAdmin) {
      throw new AppError(
        HTTP_STATUS.FORBIDDEN,
        "Not authorized to delete this comment",
      );
    }

    await comment.deleteOne();

    // Update counts
    await PostModel.findByIdAndUpdate(comment.post, {
      $inc: { "stats.commentCount": -1 },
    });
    if (comment.parentComment) {
      await CommentModel.findByIdAndUpdate(comment.parentComment, {
        $inc: { "stats.replyCount": -1 },
      });
    }
  }

  /**
   * Log a share action.
   * Note: Actual sharing happens on client side usually, or via specific APIs.
   * This logs that a share happened.
   */
  public async logShare(
    userId: string,
    postId: string,
    platform: string,
  ): Promise<void> {
    await ShareModel.create({
      user: userId,
      post: postId,
      platform,
    });
    // We already increment shareCount in postService.sharePost.
    // We can either move that logic here or keep it there.
    // For now, let's assume postService handles the count increment, and this just logs the record.
  }
}

export const interactionsService = new InteractionsService();
