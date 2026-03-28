import { Router, RequestHandler } from "express";
import { interactionsController } from "./interactions.controllers";
import { authenticate } from "../../shared/middlewares/auth.middleware";
import { validate } from "../../shared/middlewares/validate.middleware";
import { addCommentSchema } from "./dtos/add-comment.dto";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Interactions
 *   description: Comments and Social actions
 */

/**
 * @swagger
 * /api/comments/{postId}:
 *   post:
 *     summary: Add a comment to a post
 *     tags: [Interactions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content:
 *                 type: string
 *               parentCommentId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Comment added
 */

router.get(
  "/comments/:postId",
  authenticate as RequestHandler,
  interactionsController.getTopLevelComments as RequestHandler
);

/**
 * @swagger
 * /api/comments/{postId}:
 *   get:
 *     summary: Get comments for a post
 *     tags: [Interactions]
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *     responses:
 *       200:
 *         description: List of comments
 */
router.post(
  "/comments/:postId",
  authenticate as RequestHandler,
  validate(addCommentSchema),
  interactionsController.addComment as RequestHandler
);

// Fetch Replies for a specific comment
router.get(
  "/comments/:commentId/replies",
  authenticate as RequestHandler,
  interactionsController.getCommentReplies as RequestHandler
);

// Like or Unlike a comment
router.post(
  "/comments/:commentId/like",
  authenticate as RequestHandler,
  interactionsController.likeComment as RequestHandler
);

router.post(
  "/posts/:postId/like",
  authenticate as RequestHandler,
  interactionsController.likePost as RequestHandler
);

/**
 * @swagger
 * /api/comments/{commentId}:
 *   delete:
 *     summary: Delete a comment
 *     tags: [Interactions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: commentId
 *         required: true
 *     responses:
 *       200:
 *         description: Comment deleted
 */
router.delete(
  "/comments/:commentId",
  authenticate as RequestHandler,
  interactionsController.deleteComment as RequestHandler
);

router.put(
  "/comments/:commentId",
  authenticate as RequestHandler,
  interactionsController.updateComment as RequestHandler
);


export const interactionsRoutes = router;
