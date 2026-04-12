import { Router, RequestHandler } from "express";
import { postsController } from "./posts.controller";
import { authenticate } from "../../shared/middlewares/auth.middleware";
import { upload } from "../../shared/middlewares/upload.middleware";
import { validate } from "../../shared/middlewares/validate.middleware";
import { parseFormDataJson } from "../../shared/middlewares/parse-form-data.middleware"; 
import { CreatePostSchema } from "./dtos/create-post.dto";
import { updatePostSchema } from "./dtos/update-post.dto";

const router = Router();

router.get("/", authenticate as RequestHandler, postsController.getPosts as RequestHandler);

router.get("/:id", authenticate as RequestHandler, postsController.getPost as RequestHandler);

router.post(
  "/",
  authenticate as RequestHandler,
  upload.fields([
    { name: "banner", maxCount: 1 },
    { name: "media", maxCount: 10 }
  ]),
  parseFormDataJson as RequestHandler,
  validate(CreatePostSchema) as RequestHandler,
  postsController.createPost as RequestHandler
);

router.post(
  "/",
  authenticate as RequestHandler,
  upload.fields([
    { name: "banner", maxCount: 1 }, 
    { name: "media", maxCount: 10 }
  ]),
  parseFormDataJson as RequestHandler,
  validate(CreatePostSchema) as RequestHandler,
  postsController.createPost as RequestHandler,
);

router.delete("/:id", authenticate as RequestHandler, postsController.deletePost as RequestHandler);

router.put(
  "/:id",
  authenticate as RequestHandler,
  upload.fields([
    { name: "banner", maxCount: 1 },
    { name: "media", maxCount: 10 }
  ]),
  parseFormDataJson as RequestHandler,
  validate(updatePostSchema) as RequestHandler,
  postsController.updatePost as RequestHandler
);

// Ensure postsController.likePost exists or needs to be implemented.
// Based on outline it might be missing, I'll add the route assuming I'll fix the controller if needed.
// Checking outline... outline showed: createPost, getPost, getPosts, updatePost, deletePost.
// likePost IS MISSING in controller. I will add the route but I MUST add the method to controller next.
router.post("/:id/like", authenticate as RequestHandler, postsController.likePost as RequestHandler);

router.post("/:id/share", postsController.sharePost as RequestHandler);

export const postsRoutes = router;
