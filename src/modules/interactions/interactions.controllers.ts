import { Request, Response, NextFunction } from "express";

import { ApiResponse } from "@shared/utils/api-response";
import { HTTP_STATUS } from "@shared/constants/http-codes";

import type { PublicUser } from "../users/interface/user.interface";

import { interactionsService } from "./interactions.service";

import type { ReactionType } from "./contracts/reaction.types";

interface AuthRequest<
  ReqBody = unknown,
  ReqQuery = Record<string, string | undefined>,
  ReqParams = Record<string, string>,
> extends Request<ReqParams, unknown, ReqBody, ReqQuery> {
  user?: PublicUser;
}

interface AddCommentBody {
  content: string;
  parentCommentId?: string | null;
}

interface ReactionBody {
  reactionType: ReactionType;
}

class InteractionsController {
  // Comments

  /**
   * Add a comment or reply to a Post or Article.
   *
   * Uses the shared content_items identity.
   */
  public addContentItemComment = async (
    req: AuthRequest<AddCommentBody, unknown, { contentItemId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const comment = await interactionsService.createContentItemComment(
        req.user!.id,
        req.params.contentItemId,
        req.body,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.CREATED,
        "Comment added successfully",
        comment,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Retrieve top-level comments for a Post or Article.
   */
  public getContentItemComments = async (
    req: AuthRequest<
      unknown,
      {
        cursor?: string;
        limit?: string;
      },
      { contentItemId: string }
    >,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const limit =
        req.query.limit === undefined ? 20 : Number(req.query.limit);

      const data = await interactionsService.getTopLevelContentItemComments(
        req.params.contentItemId,
        limit,
        req.query.cursor,
        req.user?.id,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Comments fetched successfully",
        data,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Legacy Post-compatible comment endpoint.
   */
  public addComment = async (
    req: AuthRequest<AddCommentBody, unknown, { postId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const comment = await interactionsService.createComment(
        req.user!.id,
        req.params.postId,
        req.body,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.CREATED,
        "Comment added successfully",
        comment,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Legacy Post-compatible comment listing endpoint.
   */
  public getTopLevelComments = async (
    req: AuthRequest<
      unknown,
      {
        cursor?: string;
        limit?: string;
      },
      { postId: string }
    >,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const limit =
        req.query.limit === undefined ? 20 : Number(req.query.limit);

      const data = await interactionsService.getTopLevelComments(
        req.params.postId,
        limit,
        req.query.cursor,
        req.user?.id,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Comments fetched successfully",
        data,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Retrieve replies for a comment.
   */
  public getCommentReplies = async (
    req: AuthRequest<
      unknown,
      {
        cursor?: string;
        limit?: string;
      },
      { commentId: string }
    >,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const limit =
        req.query.limit === undefined ? 20 : Number(req.query.limit);

      const data = await interactionsService.getCommentReplies(
        req.params.commentId,
        limit,
        req.query.cursor,
        req.user?.id,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Replies fetched successfully",
        data,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Retrieve a specific comment.
   */
  public getCommentById = async (
    req: AuthRequest<unknown, unknown, { commentId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const comment = await interactionsService.getCommentById(
        req.params.commentId,
        req.user?.id,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Comment fetched successfully",
        comment,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Update a comment.
   */
  public updateComment = async (
    req: AuthRequest<{ content: string }, unknown, { commentId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const comment = await interactionsService.updateComment(
        req.user!.id,
        req.params.commentId,
        req.body.content,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Comment updated successfully",
        comment,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Delete a comment.
   */
  public deleteComment = async (
    req: AuthRequest<unknown, unknown, { commentId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      await interactionsService.deleteComment(
        req.user!.id,
        req.params.commentId,
        req.user?.role === "admin",
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Comment deleted successfully",
        null,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  // Reactions

  public setPostReaction = async (
    req: AuthRequest<ReactionBody, unknown, { postId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await interactionsService.setPostReaction(
        req.user!.id,
        req.params.postId,
        req.body.reactionType,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Post reaction updated successfully",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public removePostReaction = async (
    req: AuthRequest<unknown, unknown, { postId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await interactionsService.removePostReaction(
        req.user!.id,
        req.params.postId,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Post reaction removed successfully",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public setCommentReaction = async (
    req: AuthRequest<ReactionBody, unknown, { commentId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await interactionsService.setCommentReaction(
        req.user!.id,
        req.params.commentId,
        req.body.reactionType,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Comment reaction updated successfully",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public removeCommentReaction = async (
    req: AuthRequest<unknown, unknown, { commentId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await interactionsService.removeCommentReaction(
        req.user!.id,
        req.params.commentId,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Comment reaction removed successfully",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  // Follow

  public followUser = async (
    req: AuthRequest<unknown, unknown, { userId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await interactionsService.followUser(
        req.user!.id,
        req.params.userId,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "User followed successfully",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public unfollowUser = async (
    req: AuthRequest<unknown, unknown, { userId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await interactionsService.unfollowUser(
        req.user!.id,
        req.params.userId,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "User unfollowed successfully",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public checkFollowing = async (
    req: AuthRequest<unknown, unknown, { userId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const isFollowing = await interactionsService.isFollowing(
        req.user!.id,
        req.params.userId,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Follow status fetched successfully",
        { isFollowing },
      ).send();
    } catch (error) {
      next(error);
    }
  };

  // Saves

  /**
   * Save a Post or Article.
   */
  public saveContentItem = async (
    req: AuthRequest<unknown, unknown, { contentItemId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await interactionsService.saveContentItem(
        req.user!.id,
        req.params.contentItemId,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Content saved successfully",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Remove a saved Post or Article.
   */
  public unsaveContentItem = async (
    req: AuthRequest<unknown, unknown, { contentItemId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await interactionsService.unsaveContentItem(
        req.user!.id,
        req.params.contentItemId,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Content unsaved successfully",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Retrieve the current user's saved Posts and Articles.
   */
  public getSavedContent = async (
    req: AuthRequest<
      unknown,
      {
        cursor?: string;
        limit?: string;
      }
    >,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const limit =
        req.query.limit === undefined ? 20 : Number(req.query.limit);

      const data = await interactionsService.getSavedContent({
        userId: req.user!.id,
        limit,
        cursor: req.query.cursor,
      });

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Saved content fetched successfully",
        data,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Legacy Post-specific save endpoint.
   */
  public savePost = async (
    req: AuthRequest<unknown, unknown, { postId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await interactionsService.savePost(
        req.user!.id,
        req.params.postId,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Post saved successfully",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Legacy Post-specific unsave endpoint.
   */
  public unsavePost = async (
    req: AuthRequest<unknown, unknown, { postId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await interactionsService.unsavePost(
        req.user!.id,
        req.params.postId,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Post unsaved successfully",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Retrieve only saved Posts through the legacy API.
   */
  public getSavedPosts = async (
    req: AuthRequest<
      unknown,
      {
        cursor?: string;
        limit?: string;
      }
    >,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const limit =
        req.query.limit === undefined ? 20 : Number(req.query.limit);

      const data = await interactionsService.getSavedPosts({
        userId: req.user!.id,
        limit,
        cursor: req.query.cursor,
      });

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Saved posts fetched successfully",
        data,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  // Shares

  public createShare = async (
    req: AuthRequest<{ platform: string }, unknown, { postId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const share = await interactionsService.createShare({
        actorId: req.user!.id,
        postId: req.params.postId,
        platform: req.body.platform,
      });

      new ApiResponse(
        res,
        HTTP_STATUS.CREATED,
        "Post shared successfully",
        share,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public getPostShares = async (
    req: AuthRequest<
      unknown,
      {
        cursor?: string;
        limit?: string;
      },
      { postId: string }
    >,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const limit =
        req.query.limit === undefined ? 20 : Number(req.query.limit);

      const shares = await interactionsService.getPostShares(
        req.params.postId,
        limit,
        req.query.cursor,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Post shares fetched successfully",
        shares,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public getUserPostShares = async (
    req: AuthRequest<unknown, unknown, { postId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const shares = await interactionsService.getUserPostShares(
        req.user!.id,
        req.params.postId,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "User post shares fetched successfully",
        shares,
      ).send();
    } catch (error) {
      next(error);
    }
  };
}

export const interactionsController = new InteractionsController();
