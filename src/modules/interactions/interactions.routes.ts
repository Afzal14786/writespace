import { Router, RequestHandler } from "express";
import { interactionsController } from "./interactions.controllers";
import { authenticate } from "../../shared/middlewares/auth.middleware";
import { validate } from "../../shared/middlewares/validate.middleware";
import { addCommentSchema } from "./dtos/add-comment.dto";

const router = Router();

router.get(
  "/comments/:postId",
  authenticate as RequestHandler,
  interactionsController.getTopLevelComments as RequestHandler
);

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
