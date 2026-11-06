import { Router, RequestHandler } from "express";
import { postsController } from "./posts.controller";
import { authenticate } from "@shared/middlewares/auth.middleware";
import { upload } from "@shared/middlewares/upload.middleware";
import { validate } from "@shared/middlewares/validate.middleware";
import { parseFormDataJson } from "@shared/middlewares/parse-form-data.middleware";
import { CreatePostSchema } from "./dtos/create-post.dto";
import { updatePostSchema } from "./dtos/update-post.dto";

const router = Router();

/**
 * GET /posts/public/:id/preview
 *
 * Public endpoint for social preview crawlers.
 *
 * Authentication is intentionally omitted so platforms such as
 * LinkedIn, Facebook, WhatsApp, and Reddit can retrieve metadata.
 */
router.get(
  "/public/:id/preview",
  postsController.getPostPreview as RequestHandler,
);

/**
 * GET /posts
 *
 * Retrieve a paginated feed of published Posts.
 */
router.get(
  "/",
  authenticate as RequestHandler,
  postsController.getPosts as RequestHandler,
);

/**
 * GET /posts/:id
 *
 * Retrieve a single Post.
 */
router.get(
  "/:id",
  authenticate as RequestHandler,
  postsController.getPost as RequestHandler,
);

/**
 * POST /posts/create
 *
 * Create a Post.
 *
 * Supports JSON and multipart/form-data.
 * Multipart requests can include up to five images in the `media` field.
 */
router.post(
  "/create",
  authenticate as RequestHandler,
  upload.fields([{ name: "media", maxCount: 5 }]),
  parseFormDataJson as RequestHandler,
  validate(CreatePostSchema) as RequestHandler,
  postsController.createPost as RequestHandler,
);

/**
 * PUT /posts/:id
 *
 * Update a Post and optionally add or remove media attachments.
 */
router.put(
  "/:id",
  authenticate as RequestHandler,
  upload.fields([{ name: "media", maxCount: 5 }]),
  parseFormDataJson as RequestHandler,
  validate(updatePostSchema) as RequestHandler,
  postsController.updatePost as RequestHandler,
);

/**
 * DELETE /posts/:id
 *
 * Permanently delete a Post.
 */
router.delete(
  "/:id",
  authenticate as RequestHandler,
  postsController.deletePost as RequestHandler,
);

/**
 * POST /posts/:id/like
 *
 * Like or unlike a Post.
 */
router.post(
  "/:id/like",
  authenticate as RequestHandler,
  postsController.likePost as RequestHandler,
);

/**
 * POST /posts/:id/share
 *
 * Generate a platform-specific sharing URL.
 */
router.post(
  "/:id/share",
  authenticate as RequestHandler,
  postsController.sharePost as RequestHandler,
);

export const postsRoutes = router;
