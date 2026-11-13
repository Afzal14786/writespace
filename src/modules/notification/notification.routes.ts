import { Router } from "express";

import { authenticate } from "../../shared/middlewares/auth.middleware";
import { NotificationController } from "./notification.controller";

const router = Router();

router.use(authenticate);

// Inbox retrieval.
router.get("/", NotificationController.getNotifications);
router.get("/unread-count", NotificationController.getUnreadCount);
router.get("/:notificationId", NotificationController.getNotification);

// Inbox state mutations.
router.patch("/:notificationId/read", NotificationController.markAsRead);
router.post("/read-all", NotificationController.markAllAsRead);

router.post("/:notificationId/dismiss", NotificationController.dismiss);
router.post("/:notificationId/restore", NotificationController.restore);
router.delete("/:notificationId", NotificationController.deleteNotification);

export const notificationRoutes = router;
