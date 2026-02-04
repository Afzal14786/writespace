import { Request, Response, NextFunction } from "express";
import { interactionsService } from "./interactions.service";
import { ApiResponse } from "../../shared/utils/api-response";
import { HTTP_STATUS } from "../../shared/constants/http-codes";
import { AddCommentDto } from "./dtos/add-comment.dto";

class InteractionsController {
  public addComment = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user?.id as string;
      const postId = req.params.postId as string;
      const data: AddCommentDto = req.body;

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

  public getComments = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const postId = req.params.postId as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const comments = await interactionsService.getPostComments(
        postId,
        page,
        limit,
      );
      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Comments fetched successfully",
        comments,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public deleteComment = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user?.id as string;
      const commentId = req.params.commentId as string;
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
}

export const interactionsController = new InteractionsController();
