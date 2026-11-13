import { Router } from "express";

import { authenticate } from "../../shared/middlewares/auth.middleware";
import { NotificationPreferenceController } from "./notification-preference.controller";

const router = Router();

router.use(authenticate);

// Effective preference retrieval and updates.
router.get("/", NotificationPreferenceController.getPreferences);
router.patch("/", NotificationPreferenceController.updatePreferences);

export const notificationPreferenceRoutes = router;
