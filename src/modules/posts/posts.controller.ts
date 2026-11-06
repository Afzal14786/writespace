import type { Request, Response, NextFunction } from "express";

import { postService } from "./posts.service";

import { CreatePostSchema } from "./dtos/create-post.dto";
import { updatePostSchema } from "./dtos/update-post.dto";

import type { UpdatePostData } from "./services/post-command.service";
import type { PostMediaItem } from "./interfaces/post.interface";

import { ApiResponse } from "@shared/utils/api-response";
import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";

import { postMediaService } from "./services/post-media.service";
import { postPreviewService } from "./services/post-preview.service";

import type { PublicUser } from "@modules/users/interface/user.interface";
import type { CloudinaryFilesMap } from "@shared/types/cloudinary-file";

/**
 * Authenticated Express request.
 *
 * The authentication middleware populates `user` before protected
 * controller methods are executed.
 */
interface AuthRequest<
  ReqBody = unknown,
  ReqQuery = Record<string, string | undefined>,
  ReqParams = Record<string, string>,
> extends Request<ReqParams, unknown, ReqBody, ReqQuery> {
  user?: PublicUser;
}

/**
 * Convert an unknown request body into a plain object.
 *
 * This also protects DTO parsing from unexpected payload types such as
 * arrays, strings, or null values.
 */
function getRequestBody(body: unknown): Record<string, unknown> {
  if (body === undefined || body === null) {
    return {};
  }

  if (typeof body !== "object" || Array.isArray(body)) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      "Request body must be a JSON object",
    );
  }

  return { ...(body as Record<string, unknown>) };
}

/**
 * Parse fields that may arrive as JSON strings through multipart/form-data.
 *
 * For application/json requests, these fields are already objects or arrays
 * and are passed through unchanged.
 *
 * For multipart/form-data requests, complex values commonly arrive as
 * strings and need parsing before Zod validation.
 */
function parseJsonFields(
  body: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const parsedBody = { ...body };

  for (const field of fields) {
    const value = parsedBody[field];

    if (typeof value !== "string") {
      continue;
    }

    // An empty optional multipart field is treated as omitted.
    if (value.trim() === "") {
      delete parsedBody[field];
      continue;
    }

    try {
      parsedBody[field] = JSON.parse(value);
    } catch {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        `${field} must contain valid JSON`,
      );
    }
  }

  return parsedBody;
}

/**
 * Format Zod validation issues into a readable API error.
 *
 * Keeping validation feedback in one place avoids duplicating error
 * formatting logic in create and update handlers.
 */
function getValidationMessage(
  issues: Array<{
    path: PropertyKey[];
    message: string;
  }>,
): string {
  return issues
    .map((issue) => {
      const field = issue.path.map(String).join(".") || "body";

      return `${field}: ${issue.message}`;
    })
    .join("; ");
}

class PostsController {
  /**
   * Create a new Post.
   *
   * Supported request formats:
   * - application/json
   * - multipart/form-data with an optional `media` field
   *
   * When multipart/form-data is used, `contentDocument` and `tags`
   * should be submitted as JSON strings.
   */
  public createPost = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const authorId = req.user!.id;

      const files = req.files as CloudinaryFilesMap | undefined;

      /*
       * Convert newly uploaded Cloudinary files into the Post module's
       * internal media representation.
       */
      const mediaFiles = files?.["media"] ?? [];

      const media: PostMediaItem[] = mediaFiles.map((file) =>
        postMediaService.createMediaItem(file.location, file.public_id),
      );

      /*
       * Normalize multipart fields before validating the request.
       *
       * `contentDocument` and `tags` may be JSON strings when the request
       * uses multipart/form-data.
       */
      const requestBody = parseJsonFields(getRequestBody(req.body), [
        "contentDocument",
        "tags",
      ]);

      const validation = CreatePostSchema.safeParse({
        body: requestBody,
      });

      if (!validation.success) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          getValidationMessage(validation.error.issues),
        );
      }

      const payload = {
        ...validation.data.body,
        media,
      };

      /*
       * The service handles persistence, ownership checks, mentions,
       * lifecycle validation, and media database records.
       */
      const createdPost = await postService.createPost(authorId, payload);

      new ApiResponse(
        res,
        HTTP_STATUS.CREATED,
        "Post created successfully",
        createdPost,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get public social-sharing metadata for a Post.
   *
   * This endpoint is intentionally unauthenticated because external
   * social-media crawlers need to retrieve preview information.
   *
   * Only published Posts are returned. Draft and scheduled Posts
   * are treated as not found by the preview service.
   *
   * The response is safe to cache because it contains only public
   * Post and author information.
   */
  public getPostPreview = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const postId = req.params.id;

      // Validate the UUID before passing it to PostgreSQL.
      const UUID_REGEX =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      if (!UUID_REGEX.test(postId)) {
        throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid Post ID");
      }

      const preview = await postPreviewService.getPublicPostPreview(postId);

      /*
       * Allow browsers and shared caches to reuse public preview data.
       *
       * Keep the browser cache relatively short because Post content
       * and attachments can change after publication.
       */
      res.setHeader(
        "Cache-Control",
        "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Post preview fetched successfully",
        preview,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Fetch a paginated feed of published Posts.
   *
   * Optional query parameters:
   * - limit: number of records per page
   * - cursor: opaque pagination cursor
   * - authorId: restrict results to one author
   */
  public getPosts = async (
    req: AuthRequest<
      unknown,
      {
        cursor?: string;
        limit?: string;
        authorId?: string;
      }
    >,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const cursor = req.query.cursor;
      const limitQuery = req.query.limit;
      const authorIdFilter = req.query.authorId;

      const limit = limitQuery === undefined ? 20 : Number(limitQuery);

      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "Limit must be an integer between 1 and 50",
        );
      }

      const requesterId = req.user?.id;

      const { posts, nextCursor } = await postService.getPosts(
        limit,
        cursor,
        requesterId,
        authorIdFilter,
      );

      new ApiResponse(res, HTTP_STATUS.OK, "Posts fetched successfully", {
        posts,
        pagination: {
          limit,
          nextCursor,
        },
      }).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Fetch one Post by its ID.
   *
   * The query service determines whether the requester is allowed
   * to see the requested Post.
   */
  public getPost = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const postId = req.params.id;
      const requesterId = req.user?.id;

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

  /**
   * Update an existing Post.
   *
   * The client can:
   * - Change the structured content document.
   * - Change tags.
   * - Change its lifecycle status.
   * - Change its scheduled publication time.
   * - Upload additional images.
   * - Remove existing images using their database attachment IDs.
   *
   * Existing images are retained by default. The client does not need
   * to resend their URLs or Cloudinary public IDs.
   */
  public updatePost = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const postId = req.params.id;
      const authorId = req.user!.id;

      const files = req.files as CloudinaryFilesMap | undefined;

      /*
       * 1. Process newly uploaded images.
       *
       * Cloudinary provides the image URL and public ID.
       * Convert them into the Post module's media representation.
       */
      const mediaFiles = files?.["media"] ?? [];

      const media: PostMediaItem[] = mediaFiles.map((file) =>
        postMediaService.createMediaItem(file.location, file.public_id),
      );

      /*
       * 2. Parse multipart/form-data fields.
       *
       * Complex values such as contentDocument, tags, and removeMediaIds
       * may arrive as JSON strings rather than JavaScript objects/arrays.
       *
       * For application/json requests, they are already parsed.
       */
      const requestBody = parseJsonFields(getRequestBody(req.body), [
        "contentDocument",
        "tags",
        "removeMediaIds",
      ]);

      /*
       * 3. Validate the request using the update DTO.
       *
       * The DTO validates the document structure, tags, lifecycle fields,
       * and UUIDs of media attachment records being removed.
       */
      const validation = updatePostSchema.safeParse({
        body: requestBody,
      });

      if (!validation.success) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          getValidationMessage(validation.error.issues),
        );
      }

      /*
       * 4. Construct the command-service payload.
       *
       * removeMediaIds contains post_media.id values.
       * It does not contain Cloudinary public IDs.
       *
       * If no new images were uploaded, omit `media` so the command
       * service knows that no new attachments were supplied.
       */
      const { removeMediaIds, ...updateFields } = validation.data.body;

      const payload: UpdatePostData = {
        ...updateFields,

        ...(removeMediaIds !== undefined ? { removeMediaIds } : {}),

        ...(media.length > 0 ? { media } : {}),
      };

      /*
       * 5. Execute the update.
       *
       * The command service handles ownership, lifecycle validation,
       * database updates, mention synchronization, media synchronization,
       * and cleanup of removed Cloudinary assets.
       */
      const updatedPost = await postService.updatePost(
        postId,
        authorId,
        payload,
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

  /**
   * Permanently delete a Post.
   *
   * Deletion is restricted to the Post owner.
   * Cloudinary cleanup and related database deletion are handled
   * by the command service.
   */
  public deletePost = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const postId = req.params.id;
      const authorId = req.user!.id;

      await postService.deletePost(postId, authorId);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Post deleted successfully",
        null,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Like or unlike a Post.
   *
   * The interactions module handles reaction persistence.
   */
  public likePost = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
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

  /**
   * Generate a share URL for a published Post and record the interaction.
   */
  public sharePost = async (
    req: AuthRequest<{ platform?: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const postId = req.params.id;
      const userId = req.user!.id;

      const platform =
        typeof req.body?.platform === "string" ? req.body.platform : "generic";

      const shareData = await postService.sharePost(postId, userId, platform);

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
