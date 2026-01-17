/// <reference path="../../shared/types/express.d.ts" />
import { Request, Response, NextFunction } from "express";
import { postService } from "./posts.service";
import { CreatePostInput } from "./dtos/create-post.dto";
import { PostModel } from "./posts.model";
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
      // TODO: Add pagination and checks
      const posts = await PostModel.find({ status: "published" })
        .select("-content")
        .populate(
          "author",
          "personal_info.username personal_info.profile_image",
        )
        .sort({ publishDate: -1 })
        .limit(20);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Posts fetched successfully",
        posts,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public getPost = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const postId = req.params.id as string;
      const post = await PostModel.findById(postId).populate(
        "author",
        "personal_info.username personal_info.profile_image",
      );

      if (!post) {
        // Should throw AppError ideally, handling simple 404 here for now
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json({ message: "Post not found" });
      }

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
      const isAdmin = req.user?.account_info?.role === "admin";

      // Pass isAdmin to service to allow admins to delete any post
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
      const { platform } = req.body as { platform: string };

      const shareData = await postService.sharePost(
        postId,
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
