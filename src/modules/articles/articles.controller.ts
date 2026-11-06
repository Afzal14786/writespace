import type { Request, Response, NextFunction } from "express";

import { articleService } from "./articles.service";

import { CreateArticleSchema } from "./dtos/create-article.dto";
import { UpdateArticleSchema } from "./dtos/update-article.dto";

import type {
  CreateArticleData,
  UpdateArticleData,
} from "./services/article-command.service";

import type { ArticleCoverImage } from "./interfaces/article.interface";

import { articleMediaService } from "./services/article-media.service";

import { ApiResponse } from "@shared/utils/api-response";
import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";

import type { PublicUser } from "@modules/users/interface/user.interface";
import type { CloudinaryFilesMap } from "@shared/types/cloudinary-file";

/**
 * Authenticated Express request.
 *
 * Authentication middleware populates `user` for protected routes.
 * Public Article routes can still execute without an authenticated user.
 */
interface AuthRequest<
  ReqBody = unknown,
  ReqQuery = Record<string, string | undefined>,
  ReqParams = Record<string, string>,
> extends Request<ReqParams, unknown, ReqBody, ReqQuery> {
  user?: PublicUser;
}

/**
 * Normalize an incoming request body.
 *
 * This prevents unexpected values such as arrays or null from being
 * passed directly into DTO validation.
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

  return {
    ...(body as Record<string, unknown>),
  };
}

/**
 * Parse complex multipart/form-data fields.
 *
 * JSON requests already contain JavaScript objects and arrays.
 * Multipart requests commonly submit these values as JSON strings.
 *
 * Empty optional fields are treated as omitted.
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
 * Convert Zod validation issues into readable API error messages.
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

class ArticlesController {
  /**
   * Create a new Article.
   *
   * Supports:
   * - application/json
   * - multipart/form-data
   *
   * Multipart requests can contain one optional `coverImage` upload.
   * The actual Cloudinary URL and public ID come from the upload middleware.
   */
  public createArticle = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const authorId = req.user!.id;

      const files = req.files as CloudinaryFilesMap | undefined;

      /*
       * Parse the structured fields before validating.
       *
       * contentDocument and tags can arrive as JSON strings
       * when multipart/form-data is used.
       */
      const requestBody = parseJsonFields(getRequestBody(req.body), [
        "contentDocument",
        "tags",
      ]);

      const validation = CreateArticleSchema.safeParse({
        body: requestBody,
      });

      if (!validation.success) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          getValidationMessage(validation.error.issues),
        );
      }

      /*
       * Convert the uploaded cover image into the Article media model.
       *
       * The image is optional. An Article can be created without a cover.
       */
      const coverImageFile = files?.["coverImage"]?.[0];

      let coverImage: ArticleCoverImage | undefined;

      if (coverImageFile) {
        coverImage = articleMediaService.createCoverImage(
          coverImageFile.location,
          coverImageFile.public_id,
          validation.data.body.coverImageAltText,
          validation.data.body.coverImageCredit,
        );
      }

      const payload: CreateArticleData = {
        ...validation.data.body,
        ...(coverImage ? { coverImage } : {}),
      };

      const createdArticle = await articleService.createArticle(
        authorId,
        payload,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.CREATED,
        "Article created successfully",
        createdArticle,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Retrieve a public Article using its slug.
   *
   * An owner can also retrieve their own unpublished Article when
   * authenticated. The query service enforces visibility rules.
   */
  public getArticleBySlug = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const slug = req.params.slug;
      const requesterId = req.user?.id;

      const article = await articleService.getArticleBySlug(slug, requesterId);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Article fetched successfully",
        article,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Retrieve an Article using its database UUID.
   *
   * Primarily useful for internal operations and authenticated
   * Article management.
   */
  public getArticleById = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const articleId = req.params.id;
      const requesterId = req.user?.id;

      const article = await articleService.getArticleById(
        articleId,
        requesterId,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Article fetched successfully",
        article,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Retrieve a paginated feed of published Articles.
   *
   * Optional query parameters:
   * - limit
   * - cursor
   * - authorId
   */
  public getArticles = async (
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

      const { articles, nextCursor } = await articleService.getArticles(
        limit,
        cursor,
        requesterId,
        authorIdFilter,
      );

      new ApiResponse(res, HTTP_STATUS.OK, "Articles fetched successfully", {
        articles,
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
   * Update an existing Article.
   *
   * Supported operations:
   * - Update title, subtitle and content.
   * - Update slug explicitly.
   * - Update tags and excerpt.
   * - Change Article lifecycle state.
   * - Schedule publication.
   * - Upload or replace the cover image.
   * - Remove the existing cover image.
   *
   * Existing cover images remain unchanged unless a new image is
   * uploaded or removeCoverImage is explicitly set to true.
   */
  public updateArticle = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const articleId = req.params.id;
      const authorId = req.user!.id;

      const files = req.files as CloudinaryFilesMap | undefined;

      /*
       * Parse complex multipart fields before validation.
       */
      const requestBody = parseJsonFields(getRequestBody(req.body), [
        "contentDocument",
        "tags",
        "removeCoverImage",
      ]);

      const validation = UpdateArticleSchema.safeParse({
        body: requestBody,
      });

      if (!validation.success) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          getValidationMessage(validation.error.issues),
        );
      }

      /*
       * Convert the new cover-image upload if one was provided.
       *
       * The command service verifies that the asset belongs
       * to the authenticated user's Cloudinary folder.
       */
      const coverImageFile = files?.["coverImage"]?.[0];

      let coverImage: ArticleCoverImage | undefined;

      if (coverImageFile) {
        coverImage = articleMediaService.createCoverImage(
          coverImageFile.location,
          coverImageFile.public_id,
          validation.data.body.coverImageAltText,
          validation.data.body.coverImageCredit,
        );
      }

      const { removeCoverImage, ...updateFields } = validation.data.body;

      const payload: UpdateArticleData = {
        ...updateFields,

        ...(removeCoverImage !== undefined ? { removeCoverImage } : {}),

        ...(coverImage ? { coverImage } : {}),
      };

      const updatedArticle = await articleService.updateArticle(
        articleId,
        authorId,
        payload,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Article updated successfully",
        updatedArticle,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Permanently delete an Article.
   *
   * The authenticated author must own the Article.
   * The command service handles dependent database records
   * and Cloudinary cover-image cleanup.
   */
  public deleteArticle = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const articleId = req.params.id;
      const authorId = req.user!.id;

      await articleService.deleteArticle(articleId, authorId);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Article deleted successfully",
        null,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Retrieve public Article preview metadata.
   *
   * This endpoint is intended for social crawlers.
   *
   * It deliberately does not require authentication.
   * Only published Articles are returned by the preview service.
   */
  public getArticlePreview = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const slug = req.params.slug;

      const preview = await articleService.getPublicArticlePreview(slug);

      /*
       * Short browser caching and longer shared-cache caching.
       *
       * Metadata can change after publication, so this should
       * not be cached indefinitely.
       */
      res.setHeader(
        "Cache-Control",
        "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Article preview fetched successfully",
        preview,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Like or unlike a published Article.
   *
   * Reaction persistence is delegated to the shared interactions module.
   */
  public likeArticle = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const articleId = req.params.id;
      const userId = req.user!.id;

      const result = await articleService.likeArticle(articleId, userId);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        result.status === "liked" ? "Article liked" : "Article unliked",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Generate a platform-specific sharing destination.
   *
   * The external platform retrieves the preview from the public
   * Article URL's Open Graph metadata.
   */
  public shareArticle = async (
    req: AuthRequest<{ platform?: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const articleId = req.params.id;
      const userId = req.user!.id;

      const platform =
        typeof req.body?.platform === "string" ? req.body.platform : "generic";

      const shareData = await articleService.shareArticle(
        articleId,
        userId,
        platform,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Article share link generated",
        shareData,
      ).send();
    } catch (error) {
      next(error);
    }
  };
}

export const articlesController = new ArticlesController();
