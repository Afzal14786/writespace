import { Router } from "express";
import { postsController } from "./posts.controller";
import {
  authenticate,
  authorize,
} from "../../shared/middlewares/auth.middleware";
import { upload } from "../../shared/middlewares/upload.middleware";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Blogs
 *   description: Blog post management
 */

/**
 * @swagger
 * /api/posts:
 *   get:
 *     summary: Get all posts
 *     tags: [Blogs]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: List of posts
 */
router.get("/", postsController.getPosts);

/**
 * @swagger
 * /api/posts/{id}:
 *   get:
 *     summary: Get post details
 *     tags: [Blogs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Post details
 */
router.get("/:id", postsController.getPost);

/**
 * @swagger
 * /api/posts:
 *   post:
 *     summary: Create a new post
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               content:
 *                 type: string
 *               banner:
 *                 type: string
 *                 format: binary
 *               draft:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Post created successfully
 */
// Note: Validation for multipart/form-data with Zod is tricky directly in middleware if logic is complex.
// Ideally, we validate the parsed body. `upload` middleware runs first.
import { validate } from "../../shared/middlewares/validate.middleware";
import { CreatePostSchema } from "./dtos/create-post.dto";

router.post(
  "/",
  authenticate,
  upload.single("banner"),
  validate(CreatePostSchema),
  postsController.createPost,
);

/**
 * @swagger
 * /api/posts/{id}:
 *   put:
 *     summary: Update a post
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
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
 *               title:
 *                 type: string
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: Post updated
 */
router.put("/:id", authenticate, postsController.updatePost);

/**
 * @swagger
 * /api/posts/{id}:
 *   delete:
 *     summary: Delete a post
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Post deleted
 */
router.delete("/:id", authenticate, postsController.deletePost);

/**
 * @swagger
 * /api/posts/{id}/like:
 *   post:
 *     summary: Like a post
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Post liked status toggled
 */
// Ensure postsController.likePost exists or needs to be implemented.
// Based on outline it might be missing, I'll add the route assuming I'll fix the controller if needed.
// Checking outline... outline showed: createPost, getPost, getPosts, updatePost, deletePost.
// likePost IS MISSING in controller. I will add the route but I MUST add the method to controller next.
router.post("/:id/like", authenticate, postsController.likePost);

/**
 * @swagger
 * /api/posts/{id}/share:
 *   post:
 *     summary: Share a post
 *     tags: [Blogs]
 *     parameters:
 *       - in: path
 *         name: id
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
 *               platform:
 *                 type: string
 *     responses:
 *       200:
 *         description: Share link generated
 * */
router.post("/:id/share", postsController.sharePost);

export const postsRoutes = router;
