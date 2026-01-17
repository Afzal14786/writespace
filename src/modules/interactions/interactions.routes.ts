import { Router } from "express";
import { interactionsController } from "./interactions.controllers";
import { authenticate } from "../../shared/middlewares/auth.middleware";

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
import { validate } from "../../shared/middlewares/validate.middleware";
import { AddCommentSchema } from "./dtos/add-comment.dto";

router.post(
  "/comments/:postId",
  authenticate,
  validate(AddCommentSchema),
  interactionsController.addComment,
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
router.get("/comments/:postId", interactionsController.getComments);

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
  authenticate,
  interactionsController.deleteComment,
);

export const interactionsRoutes = router;
