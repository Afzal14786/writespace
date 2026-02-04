/// <reference path="../../shared/types/express.d.ts" />
import { Request, Response, NextFunction } from "express";
import { postService } from "./posts.service";
import { CreatePostInput } from "./dtos/create-post.dto";
import { ApiResponse } from "../../shared/utils/api-response";
import { HTTP_STATUS } from "../../shared/constants/http-codes";

class PostsController {
  public createPost = async (
    req: Request<{}, {}, CreatePostInput>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const authorId = req.user?.id as string;
      const file = req.file as Express.Multer.File & { location?: string };

      if (file?.location) {
        req.body.coverImage = {
          url: file.location,
          altText: req.body.coverImage?.altText,
          credit: req.body.coverImage?.credit,
        };
      }

      const newPost = await postService.createPost(authorId, req.body);
      new ApiResponse(
        res,
        HTTP_STATUS.CREATED,
        "Post created successfully",
        newPost,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public getPosts = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(
        50,
        Math.max(1, parseInt(req.query.limit as string) || 20),
      );

      const { posts, total } = await postService.getPosts(page, limit);

      new ApiResponse(res, HTTP_STATUS.OK, "Posts fetched successfully", {
        posts,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      }).send();
    } catch (error) {
      next(error);
    }
  };

  public getPost = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const postId = req.params.id as string;
      const requesterId = req.user?.id as string | undefined;
      const post = await postService.getPost(postId, requesterId);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Post fetched successfully",
        post,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public updatePost = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const postId = req.params.id as string;
      const authorId = req.user?.id as string;

      const updatedPost = await postService.updatePost(
        postId,
        authorId,
        req.body,
      );
      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Post updated successfully",
        updatedPost,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public deletePost = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const postId = req.params.id as string;
      const authorId = req.user?.id as string;
      const isAdmin = req.user?.role === "admin";

      await postService.deletePost(postId, authorId, isAdmin);
      new ApiResponse(res, HTTP_STATUS.OK, "Post moved to trash", null).send();
    } catch (error) {
      next(error);
    }
  };

  public likePost = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const postId = req.params.id as string;
      const userId = req.user?.id as string;

      const result = await postService.likePost(postId, userId);
      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        result.status === "liked" ? "Post liked" : "Post unliked",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public sharePost = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const postId = req.params.id as string;
      const userId = req.user?.id as string;
      const { platform } = req.body as { platform: string };

      const shareData = await postService.sharePost(
        postId,
        userId,
        platform || "generic",
      );
      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Share link generated",
        shareData,
      ).send();
    } catch (error) {
      next(error);
    }
  };
}

export const postsController = new PostsController();
