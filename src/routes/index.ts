import { Router } from "express";

import { authRoutes } from "@modules/auth/auth.routes";
import { userRoutes } from "@modules/users/user.routes";
import { postsRoutes } from "@modules/posts/posts.routes";
import { articlesRoutes } from "@modules/articles/articles.routes";
import { aiRoutes } from "@modules/ai/ai.routes";
import { notificationRoutes } from "@modules/notification/notification.routes";
import { interactionsRoutes } from "@modules/interactions/interactions.routes";
import { notificationPreferenceRoutes } from "@modules/notification/notification-preference.routes";

const router = Router();

/**
 * Authentication and user management.
 */
router.use("/auth", authRoutes);
router.use("/users", userRoutes);

/**
 * Content modules.
 *
 * Posts and Articles share the content_items infrastructure
 * but maintain separate module responsibilities.
 */
router.use("/posts", postsRoutes);
router.use("/articles", articlesRoutes);

/**
 * Supporting platform modules.
 */
router.use("/ai", aiRoutes);
router.use("/notifications", notificationRoutes);
router.use("/notification-preferences", notificationPreferenceRoutes);
router.use("/interactions", interactionsRoutes);

export default router;
