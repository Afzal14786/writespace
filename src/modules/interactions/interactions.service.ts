import { commentService } from "./services/comment.service";
import { reactionService } from "./services/reaction.service";
import { followService } from "./services/follow.service";
import { saveService } from "./services/save.service";
import { shareService } from "./services/share.service";

import type {
  ReactionType,
  ReactionResult,
  ReactionTargetType,
} from "./contracts/reaction.types";

import type { FollowResult } from "./contracts/follow.types";

import type { SavedPostResult, SavedPostQuery } from "./contracts/save.types";

import type {
  SavedContentResult,
  SavedContentQuery,
} from "./services/save.service";

import type {
  CreateContentItemShareInput,
  CreateShareInput,
  ContentItemSharePageResult,
  ContentItemShareResult,
  SharePageResult,
  ShareResult,
} from "./contracts/share.types";

interface CreateCommentInput {
  content: string;
  parentCommentId?: string | null;
}

class InteractionsService {
  // Comments

  /**
   * Create a comment on a Post or Article.
   *
   * Both content types use the shared content_items identity.
   */
  async createContentItemComment(
    userId: string,
    contentItemId: string,
    input: CreateCommentInput,
  ) {
    return commentService.createComment(
      userId,
      contentItemId,
      input.content,
      input.parentCommentId,
    );
  }

  /**
   * Legacy Post-compatible comment method.
   */
  async createComment(
    userId: string,
    postId: string,
    input: CreateCommentInput,
  ) {
    return this.createContentItemComment(userId, postId, input);
  }

  async getTopLevelContentItemComments(
    contentItemId: string,
    limit: number = 20,
    cursor?: string,
    requesterId?: string,
  ) {
    return commentService.getTopLevelComments(
      contentItemId,
      limit,
      cursor,
      requesterId,
    );
  }

  /**
   * Legacy Post-compatible method.
   */
  async getTopLevelComments(
    postId: string,
    limit: number = 20,
    cursor?: string,
    requesterId?: string,
  ) {
    return this.getTopLevelContentItemComments(
      postId,
      limit,
      cursor,
      requesterId,
    );
  }

  async getCommentReplies(
    parentCommentId: string,
    limit: number = 20,
    cursor?: string,
    requesterId?: string,
  ) {
    return commentService.getCommentReplies(
      parentCommentId,
      limit,
      cursor,
      requesterId,
    );
  }

  async getCommentById(commentId: string, requesterId?: string) {
    return commentService.getCommentById(commentId, requesterId);
  }

  async updateComment(userId: string, commentId: string, content: string) {
    return commentService.updateComment(userId, commentId, content);
  }

  async deleteComment(
    userId: string,
    commentId: string,
    isAdmin: boolean = false,
  ): Promise<void> {
    return commentService.deleteComment(userId, commentId, isAdmin);
  }

  // Reactions

  /**
   * Set a reaction on a content item or comment.
   *
   * CONTENT_ITEM supports Posts and Articles.
   * POST remains accepted as a legacy alias.
   */
  async setReaction(
    actorId: string,
    targetId: string,
    targetType: ReactionTargetType,
    reactionType: ReactionType,
  ): Promise<ReactionResult> {
    return reactionService.setReaction({
      actorId,
      targetId,
      targetType,
      reactionType,
    });
  }

  async removeReaction(
    actorId: string,
    targetId: string,
    targetType: ReactionTargetType,
  ): Promise<ReactionResult> {
    return reactionService.removeReaction({
      actorId,
      targetId,
      targetType,
    });
  }

  /**
   * Generic Post and Article reaction operation.
   */
  async setContentItemReaction(
    actorId: string,
    contentItemId: string,
    reactionType: ReactionType,
  ): Promise<ReactionResult> {
    return reactionService.setContentItemReaction(
      actorId,
      contentItemId,
      reactionType,
    );
  }

  /**
   * Atomically toggle Like on a Post or Article.
   */
  async toggleContentItemLike(
    actorId: string,
    contentItemId: string,
  ): Promise<ReactionResult> {
    return reactionService.toggleContentItemLike(actorId, contentItemId);
  }

  async removeContentItemReaction(
    actorId: string,
    contentItemId: string,
  ): Promise<ReactionResult> {
    return reactionService.removeContentItemReaction(actorId, contentItemId);
  }

  /**
   * Backward-compatible Post reaction methods.
   */
  async setPostReaction(
    actorId: string,
    postId: string,
    reactionType: ReactionType,
  ): Promise<ReactionResult> {
    return this.setContentItemReaction(actorId, postId, reactionType);
  }

  async removePostReaction(
    actorId: string,
    postId: string,
  ): Promise<ReactionResult> {
    return this.removeContentItemReaction(actorId, postId);
  }

  async setCommentReaction(
    actorId: string,
    commentId: string,
    reactionType: ReactionType,
  ): Promise<ReactionResult> {
    return this.setReaction(actorId, commentId, "COMMENT", reactionType);
  }

  async removeCommentReaction(
    actorId: string,
    commentId: string,
  ): Promise<ReactionResult> {
    return this.removeReaction(actorId, commentId, "COMMENT");
  }

  // Follow

  async followUser(
    actorId: string,
    targetUserId: string,
  ): Promise<FollowResult> {
    return followService.followUser({
      actorId,
      targetUserId,
    });
  }

  async unfollowUser(
    actorId: string,
    targetUserId: string,
  ): Promise<FollowResult> {
    return followService.unfollowUser({
      actorId,
      targetUserId,
    });
  }

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    return followService.isFollowing(followerId, followingId);
  }

  // Saves

  /**
   * Save a Post or Article.
   */
  async saveContentItem(
    actorId: string,
    contentItemId: string,
  ): Promise<SavedContentResult> {
    return saveService.saveContentItem({
      actorId,
      contentItemId,
    });
  }

  /**
   * Remove a saved Post or Article.
   */
  async unsaveContentItem(
    actorId: string,
    contentItemId: string,
  ): Promise<SavedContentResult> {
    return saveService.unsaveContentItem({
      actorId,
      contentItemId,
    });
  }

  /**
   * Check saved status for a Post or Article.
   */
  async isContentItemSaved(
    userId: string,
    contentItemId: string,
  ): Promise<boolean> {
    return saveService.isContentItemSaved(userId, contentItemId);
  }

  /**
   * Retrieve saved Posts and Articles together.
   */
  async getSavedContent(input: SavedContentQuery) {
    return saveService.getSavedContent(input);
  }

  /**
   * Backward-compatible Post-specific save methods.
   */
  async savePost(actorId: string, postId: string): Promise<SavedPostResult> {
    return saveService.savePost({
      actorId,
      postId,
    });
  }

  async unsavePost(actorId: string, postId: string): Promise<SavedPostResult> {
    return saveService.unsavePost({
      actorId,
      postId,
    });
  }

  async isPostSaved(userId: string, postId: string): Promise<boolean> {
    return saveService.isPostSaved(userId, postId);
  }

  async getSavedPosts(input: SavedPostQuery) {
    return saveService.getSavedPosts(input);
  }

  // Shares

  /**
   * Create a share for a Post or Article.
   */
  async createContentItemShare(
    input: CreateContentItemShareInput,
  ): Promise<ContentItemShareResult> {
    return shareService.createContentItemShare(input);
  }

  /**
   * Retrieve one share record for a Post or Article.
   */
  async getContentItemShareById(
    id: number,
  ): Promise<ContentItemShareResult | null> {
    return shareService.getContentItemShareById(id);
  }

  /**
   * Retrieve paginated shares for a Post or Article.
   */
  async getContentItemShares(
    contentItemId: string,
    limit: number,
    cursor?: string,
  ): Promise<ContentItemSharePageResult> {
    return shareService.getContentItemShares(contentItemId, limit, cursor);
  }

  /**
   * Retrieve shares made by a specific user for a Post or Article.
   */
  async getUserContentItemShares(
    userId: string,
    contentItemId: string,
  ): Promise<ContentItemShareResult[]> {
    return shareService.getUserContentItemShares(userId, contentItemId);
  }

  /**
   * Backward-compatible Post-specific share methods.
   */
  async createShare(input: CreateShareInput): Promise<ShareResult> {
    return shareService.createShare(input);
  }

  async getShareById(id: number): Promise<ShareResult | null> {
    return shareService.getShareById(id);
  }

  async getPostShares(
    postId: string,
    limit: number,
    cursor?: string,
  ): Promise<SharePageResult> {
    return shareService.getPostShares(postId, limit, cursor);
  }

  async getUserPostShares(
    userId: string,
    postId: string,
  ): Promise<ShareResult[]> {
    return shareService.getUserPostShares(userId, postId);
  }
}

export const interactionsService = new InteractionsService();
