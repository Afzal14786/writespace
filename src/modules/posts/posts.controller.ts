import { Request, Response, NextFunction } from "express";
import { postService } from "./posts.service";
import { CreatePostInput } from "./dtos/create-post.dto";
import { ApiResponse } from "../../shared/utils/api-response";
import { HTTP_STATUS } from "../../shared/constants/http-codes";
import type { CodeSnippetSchema } from "../../db/schema/posts";
import type { PublicUser } from "../users/interface/user.interface"; 

interface AuthRequest<
  ReqBody = unknown,
  ReqQuery = Record<string, string | undefined>,
  ReqParams = Record<string, string>
> extends Request<ReqParams, unknown, ReqBody, ReqQuery> {
  user?: PublicUser;
}

type UploadedFile = Express.Multer.File & { location?: string; path?: string };

class PostsController {
  public createPost = async (
    req: AuthRequest<CreatePostInput & { media?: string[]; codeSnippets?: unknown }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const authorId = req.user!.id; 
      const file = req.file as UploadedFile | undefined;

      // 🔥 Safely cast the body to the final payload structure we intend to send
      const payload = req.body as CreatePostInput & { media: string[], codeSnippets: CodeSnippetSchema[] };

      if (file?.location) {
        payload.coverImage = {
          url: file.location,
          altText: payload.coverImage?.altText,
          credit: payload.coverImage?.credit,
        };
      }

      let parsedCodeSnippets: CodeSnippetSchema[] = [];
      if (req.body.codeSnippets) {
        if (typeof req.body.codeSnippets === "string") {
          try {
            parsedCodeSnippets = JSON.parse(req.body.codeSnippets) as CodeSnippetSchema[];
          } catch (e: unknown) {
            console.error(e);
            parsedCodeSnippets = [];
          }
        } else if (Array.isArray(req.body.codeSnippets)) {
          parsedCodeSnippets = req.body.codeSnippets as unknown as CodeSnippetSchema[];
        }
      }
      
      payload.codeSnippets = parsedCodeSnippets;

      const files = req.files as UploadedFile[] | undefined;
      const mediaUrls: string[] = [];

      if (files && files.length > 0) {
        files.forEach((f) => {
          if (f.location) {
            mediaUrls.push(f.location);
          } else if (f.path) {
            mediaUrls.push(f.path);
          }
        });
      }

      payload.media = mediaUrls;

      if (mediaUrls.length > 0 && !payload.coverImage) {
         payload.coverImage = { url: mediaUrls[0] }; 
      }

      const newPost = await postService.createPost(authorId, payload);
      
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

  public getPosts = async (
    // 🔥 FIX: We explicitly define the expected query parameters for this specific route!
    req: AuthRequest<unknown, { page?: string; limit?: string }>, 
    res: Response, 
    next: NextFunction
  ) => {
    try {
      const pageQuery = req.query.page;
      const limitQuery = req.query.limit;
      
      // 🔥 FIX: Safe parsing. If undefined, it falls back to "1" / "20", satisfying parseInt's string requirement
      const page = Math.max(1, parseInt(pageQuery || "1", 10));
      const limit = Math.min(50, Math.max(1, parseInt(limitQuery || "20", 10)));
      
      const requesterId = req.user?.id;

      const { posts, total } = await postService.getPosts(page, limit, requesterId);

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

  public getPost = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const postId = req.params.id;
      const requesterId = req.user?.id;
      const post = await postService.getPost(postId, requesterId);

      new ApiResponse(res, HTTP_STATUS.OK, "Post fetched successfully", post).send();
    } catch (error) {
      next(error);
    }
  };

  public updatePost = async (req: AuthRequest<Partial<CreatePostInput>>, res: Response, next: NextFunction) => {
    try {
      const postId = req.params.id;
      const authorId = req.user!.id;

      const updatedPost = await postService.updatePost(postId, authorId, req.body);
      new ApiResponse(res, HTTP_STATUS.OK, "Post updated successfully", updatedPost).send();
    } catch (error) {
      next(error);
    }
  };

  public deletePost = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const postId = req.params.id;
      const authorId = req.user!.id;
      const isAdmin = req.user!.role === "admin";

      await postService.deletePost(postId, authorId, isAdmin);
      new ApiResponse(res, HTTP_STATUS.OK, "Post deleted successfully", null).send();
    } catch (error) {
      next(error);
    }
  };

  public likePost = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const postId = req.params.id;
      const userId = req.user!.id;

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

  public sharePost = async (req: AuthRequest<{ platform?: string }>, res: Response, next: NextFunction) => {
    try {
      const postId = req.params.id;
      const userId = req.user!.id;
      const platform = req.body.platform;

      const shareData = await postService.sharePost(postId, userId, platform || "generic");
      new ApiResponse(res, HTTP_STATUS.OK, "Share link generated", shareData).send();
    } catch (error) {
      next(error);
    }
  };
}

export const postsController = new PostsController();