import { Router, RequestHandler } from "express";

import { articlesController } from "./articles.controller";

import { authenticate } from "../../shared/middlewares/auth.middleware";
import { upload } from "../../shared/middlewares/upload.middleware";
import { validate } from "../../shared/middlewares/validate.middleware";
import { parseFormDataJson } from "../../shared/middlewares/parse-form-data.middleware";

import { CreateArticleSchema } from "./dtos/create-article.dto";
import { UpdateArticleSchema } from "./dtos/update-article.dto";

const router = Router();

/**
 * GET /articles/public/:slug/preview
 *
 * Public endpoint for social-media crawlers.
 *
 * Authentication is intentionally omitted so that external platforms
 * can retrieve metadata for published Articles.
 *
 * Draft and scheduled Articles are rejected by the preview service.
 *
 * Register this before the dynamic slug route.
 */
router.get(
  "/public/:slug/preview",
  articlesController.getArticlePreview as RequestHandler,
);

/**
 * GET /articles
 *
 * Retrieve a paginated Article feed.
 */
router.get(
  "/",
  authenticate as RequestHandler,
  articlesController.getArticles as RequestHandler,
);

/**
 * GET /articles/id/:id
 *
 * Retrieve an Article using its database UUID.
 *
 * This route is separate from the slug route to avoid ambiguity
 * between an Article slug and a UUID.
 */
router.get(
  "/id/:id",
  authenticate as RequestHandler,
  articlesController.getArticleById as RequestHandler,
);

/**
 * GET /articles/:slug
 *
 * Retrieve an Article using its public slug.
 *
 * Example:
 * /articles/understanding-redis-internals-a1b2c3
 */
router.get(
  "/:slug",
  authenticate as RequestHandler,
  articlesController.getArticleBySlug as RequestHandler,
);

/**
 * POST /articles/create
 *
 * Create an Article.
 *
 * Supports:
 * - application/json
 * - multipart/form-data
 *
 * Multipart requests can contain one optional cover image.
 */
router.post(
  "/create",
  authenticate as RequestHandler,
  upload.fields([{ name: "coverImage", maxCount: 1 }]),
  parseFormDataJson as RequestHandler,
  validate(CreateArticleSchema) as RequestHandler,
  articlesController.createArticle as RequestHandler,
);

/**
 * PUT /articles/:id
 *
 * Update an existing Article.
 *
 * A new cover image replaces the existing one.
 * Existing cover images remain unchanged when no new file is uploaded.
 */
router.put(
  "/:id",
  authenticate as RequestHandler,
  upload.fields([{ name: "coverImage", maxCount: 1 }]),
  parseFormDataJson as RequestHandler,
  validate(UpdateArticleSchema) as RequestHandler,
  articlesController.updateArticle as RequestHandler,
);

/**
 * DELETE /articles/:id
 *
 * Permanently delete an Article.
 */
router.delete(
  "/:id",
  authenticate as RequestHandler,
  articlesController.deleteArticle as RequestHandler,
);

/**
 * POST /articles/:id/like
 *
 * Like or unlike an Article.
 */
router.post(
  "/:id/like",
  authenticate as RequestHandler,
  articlesController.likeArticle as RequestHandler,
);

/**
 * POST /articles/:id/share
 *
 * Generate a platform-specific Article sharing URL.
 */
router.post(
  "/:id/share",
  authenticate as RequestHandler,
  articlesController.shareArticle as RequestHandler,
);

export const articlesRoutes = router;
