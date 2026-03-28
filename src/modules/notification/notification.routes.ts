import { Router } from "express";
import { NotificationController } from "./notification.controller";
import { authenticate } from "../../shared/middlewares/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/", NotificationController.getNotifications);

router.put("/read", NotificationController.markAsRead);

router.put("/read-all", NotificationController.markAllAsRead);

export const notificationRoutes = router;