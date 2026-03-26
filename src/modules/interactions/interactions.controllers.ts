import { Request, Response, NextFunction } from "express";
import { interactionsService } from "./interactions.service";
import { ApiResponse } from "../../shared/utils/api-response";
import { HTTP_STATUS } from "../../shared/constants/http-codes";
import { AddCommentDto } from "./dtos/add-comment.dto";
import type { PublicUser } from "../users/interface/user.interface";
import { AppError } from "../../shared/utils/app.error";

interface AuthRequest<
  ReqBody = unknown,
  ReqQuery = Record<string, string | undefined>,
  ReqParams = Record<string, string>
> extends Request<ReqParams, unknown, ReqBody, ReqQuery> {
  user?: PublicUser;
}

class InteractionsController {
  public addComment = async (
    req: AuthRequest<AddCommentDto, unknown, { postId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const postId = req.params.postId;
      const data = req.body;

      const comment = await interactionsService.createComment(
        userId,
        postId,
        data,
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

  // 🔥 1. Controller for Top Level Comments
  public getTopLevelComments = async (
    req: AuthRequest<unknown, { cursor?: string; limit?: string }, { postId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const postId = req.params.postId;
      const limit = parseInt(req.query.limit || "20", 10);
      const cursor = req.query.cursor;
      const requesterId = req.user?.id; // Optional for auth-aware fetching

      const data = await interactionsService.getTopLevelComments(
        postId,
        limit,
        cursor,
        requesterId
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

  // 🔥 2. Controller for Fetching Nested Replies
  public getCommentReplies = async (
    req: AuthRequest<unknown, { cursor?: string; limit?: string }, { commentId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const commentId = req.params.commentId;
      const limit = parseInt(req.query.limit || "20", 10);
      const cursor = req.query.cursor;
      const requesterId = req.user?.id;

      const data = await interactionsService.getCommentReplies(
        commentId,
        limit,
        cursor,
        requesterId
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

  // 🔥 3. Controller for Liking Comments
  public likeComment = async (
    req: AuthRequest<unknown, unknown, { commentId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const commentId = req.params.commentId;

      const result = await interactionsService.likeComment(commentId, userId);
      
      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        result.status === "liked" ? "Comment liked" : "Comment unliked",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public deleteComment = async (
    req: AuthRequest<unknown, unknown, { commentId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const commentId = req.params.commentId;
      const isAdmin = req.user?.role === "admin";

      await interactionsService.deleteComment(userId, commentId, isAdmin);
      
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

  public updateComment = async (
    req: AuthRequest<{ content: string }, unknown, { commentId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const commentId = req.params.commentId;
      const { content } = req.body;

      if (!content || content.trim().length === 0) {
        throw new AppError(HTTP_STATUS.BAD_REQUEST, "Comment content cannot be empty");
      }

      const updatedComment = await interactionsService.updateComment(
        userId,
        commentId,
        content
      );
      
      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Comment updated successfully",
        updatedComment,
      ).send();
    } catch (error) {
      next(error);
    }
  };
}

export const interactionsController = new InteractionsController();