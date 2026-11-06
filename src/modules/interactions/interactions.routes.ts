import { Router, RequestHandler } from "express";
import { interactionsController } from "./interactions.controllers";
import { authenticate } from "../../shared/middlewares/auth.middleware";
import { validate } from "../../shared/middlewares/validate.middleware";
import { addCommentSchema } from "./dtos/add-comment.dto";
import { updateCommentSchema } from "./dtos/update-comment.dto";
import { setReactionSchema } from "./dtos/set-reaction.dto";

const router = Router();

// Generic content-item comments (Posts and Articles)

/**
 * GET /interactions/content/:contentItemId/comments
 *
 * Retrieve top-level comments for a Post or Article.
 */
router.get(
  "/content/:contentItemId/comments",
  authenticate as RequestHandler,
  interactionsController.getContentItemComments as RequestHandler,
);

/**
 * POST /interactions/content/:contentItemId/comments
 *
 * Add a comment or reply to a Post or Article.
 */
router.post(
  "/content/:contentItemId/comments",
  authenticate as RequestHandler,
  validate(addCommentSchema),
  interactionsController.addContentItemComment as RequestHandler,
);

// Legacy Post-compatible comments

/**
 * GET /interactions/comments/:postId
 *
 * Legacy Post comment listing endpoint.
 */
router.get(
  "/comments/:postId",
  authenticate as RequestHandler,
  interactionsController.getTopLevelComments as RequestHandler,
);

/**
 * POST /interactions/comments/:postId
 *
 * Legacy Post comment creation endpoint.
 */
router.post(
  "/comments/:postId",
  authenticate as RequestHandler,
  validate(addCommentSchema),
  interactionsController.addComment as RequestHandler,
);

// Comment replies and comment management

router.get(
  "/comments/:commentId/replies",
  authenticate as RequestHandler,
  interactionsController.getCommentReplies as RequestHandler,
);

/**
 * Get a specific comment by ID.
 *
 * A distinct path is required because GET /comments/:postId
 * is already used to retrieve top-level comments.
 */
router.get(
  "/comments/:commentId/detail",
  authenticate as RequestHandler,
  interactionsController.getCommentById as RequestHandler,
);

router.put(
  "/comments/:commentId",
  authenticate as RequestHandler,
  validate(updateCommentSchema),
  interactionsController.updateComment as RequestHandler,
);

router.delete(
  "/comments/:commentId",
  authenticate as RequestHandler,
  interactionsController.deleteComment as RequestHandler,
);

// Reactions

router.post(
  "/posts/:postId/reaction",
  authenticate as RequestHandler,
  validate(setReactionSchema),
  interactionsController.setPostReaction as RequestHandler,
);

router.delete(
  "/posts/:postId/reaction",
  authenticate as RequestHandler,
  interactionsController.removePostReaction as RequestHandler,
);

router.post(
  "/comments/:commentId/reaction",
  authenticate as RequestHandler,
  validate(setReactionSchema),
  interactionsController.setCommentReaction as RequestHandler,
);

router.delete(
  "/comments/:commentId/reaction",
  authenticate as RequestHandler,
  interactionsController.removeCommentReaction as RequestHandler,
);

// Follow

router.post(
  "/users/:userId/follow",
  authenticate as RequestHandler,
  interactionsController.followUser as RequestHandler,
);

router.delete(
  "/users/:userId/follow",
  authenticate as RequestHandler,
  interactionsController.unfollowUser as RequestHandler,
);

router.get(
  "/users/:userId/follow",
  authenticate as RequestHandler,
  interactionsController.checkFollowing as RequestHandler,
);

// Generic content-item saves (Posts and Articles)

/**
 * POST /interactions/content/:contentItemId/save
 *
 * Save a Post or Article.
 */
router.post(
  "/content/:contentItemId/save",
  authenticate as RequestHandler,
  interactionsController.saveContentItem as RequestHandler,
);

/**
 * DELETE /interactions/content/:contentItemId/save
 *
 * Remove a saved Post or Article.
 */
router.delete(
  "/content/:contentItemId/save",
  authenticate as RequestHandler,
  interactionsController.unsaveContentItem as RequestHandler,
);

/**
 * GET /interactions/saved-content
 *
 * Retrieve the current user's saved Posts and Articles together.
 */
router.get(
  "/saved-content",
  authenticate as RequestHandler,
  interactionsController.getSavedContent as RequestHandler,
);

// Legacy Post-compatible saves

router.post(
  "/posts/:postId/save",
  authenticate as RequestHandler,
  interactionsController.savePost as RequestHandler,
);

router.delete(
  "/posts/:postId/save",
  authenticate as RequestHandler,
  interactionsController.unsavePost as RequestHandler,
);

router.get(
  "/saved-posts",
  authenticate as RequestHandler,
  interactionsController.getSavedPosts as RequestHandler,
);

// Shares

router.post(
  "/posts/:postId/share",
  authenticate as RequestHandler,
  interactionsController.createShare as RequestHandler,
);

router.get(
  "/posts/:postId/shares",
  authenticate as RequestHandler,
  interactionsController.getPostShares as RequestHandler,
);

router.get(
  "/posts/:postId/my-shares",
  authenticate as RequestHandler,
  interactionsController.getUserPostShares as RequestHandler,
);

export const interactionsRoutes = router;
