import type { Request, Response, NextFunction } from "express";
import { z } from "zod";

import { ApiResponse } from "@shared/utils/api-response";
import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";

import { notificationInboxService } from "./services/notification-inbox.service";

const inboxQuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^[1-9]\d*$/)
      .optional(),

    cursor: z.string().min(1).max(512).optional(),

    view: z.enum(["active", "archived", "dismissed"]).optional(),

    unread: z.enum(["true", "false"]).optional(),

    category: z.string().trim().min(1).max(100).optional(),

    type: z.string().trim().min(1).max(150).optional(),
  })
  .strict();

const notificationIdSchema = z.string().uuid();

function getRecipientId(req: Request): string {
  if (!req.user) {
    throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Authentication required.");
  }

  return req.user.id;
}

function getNotificationId(req: Request): string {
  const parsed = notificationIdSchema.safeParse(req.params.notificationId);

  if (!parsed.success) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      "A valid notification ID is required.",
    );
  }

  return parsed.data;
}

function setPrivateNoStore(res: Response): void {
  res.setHeader("Cache-Control", "private, no-store");
}

export class NotificationController {
  /**
   * GET /notifications
   *
   * Supports cursor pagination, inbox views, read-state filtering,
   * category filtering and notification-type filtering.
   *
   * Recipient identity always comes from authentication.
   */
  public static async getNotifications(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const recipientId = getRecipientId(req);
      const parsedQuery = inboxQuerySchema.safeParse(req.query);

      if (!parsedQuery.success) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "Invalid notification query parameters.",
        );
      }

      const limit = parsedQuery.data.limit
        ? Number(parsedQuery.data.limit)
        : 20;

      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "Notification limit must be between 1 and 50.",
        );
      }

      const data = await notificationInboxService.getInbox(recipientId, {
        limit,
        cursor: parsedQuery.data.cursor,
        view: parsedQuery.data.view,
        unread:
          parsedQuery.data.unread === undefined
            ? undefined
            : parsedQuery.data.unread === "true",
        category: parsedQuery.data.category,
        type: parsedQuery.data.type,
      });

      setPrivateNoStore(res);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Notifications retrieved successfully.",
        data,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /notifications/unread-count
   */
  public static async getUnreadCount(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const recipientId = getRecipientId(req);

      const data = await notificationInboxService.getUnreadCount(recipientId);

      setPrivateNoStore(res);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Unread notification count retrieved successfully.",
        data,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /notifications/:notificationId
   */
  public static async getNotification(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const recipientId = getRecipientId(req);
      const notificationId = getNotificationId(req);

      const data = await notificationInboxService.getNotification(
        recipientId,
        notificationId,
      );

      setPrivateNoStore(res);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Notification retrieved successfully.",
        data,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /notifications/:notificationId/read
   */
  public static async markAsRead(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const recipientId = getRecipientId(req);
      const notificationId = getNotificationId(req);

      const data = await notificationInboxService.markAsRead(
        recipientId,
        notificationId,
      );

      setPrivateNoStore(res);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Notification marked as read.",
        data,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /notifications/read-all
   */
  public static async markAllAsRead(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const recipientId = getRecipientId(req);

      const data = await notificationInboxService.markAllAsRead(recipientId);

      setPrivateNoStore(res);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Notifications marked as read.",
        data,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /notifications/:notificationId/dismiss
   */
  public static async dismiss(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const recipientId = getRecipientId(req);
      const notificationId = getNotificationId(req);

      const data = await notificationInboxService.dismiss(
        recipientId,
        notificationId,
      );

      setPrivateNoStore(res);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Notification dismissed successfully.",
        data,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /notifications/:notificationId/restore
   */
  public static async restore(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const recipientId = getRecipientId(req);
      const notificationId = getNotificationId(req);

      const data = await notificationInboxService.restore(
        recipientId,
        notificationId,
      );

      setPrivateNoStore(res);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Notification restored successfully.",
        data,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /notifications/:notificationId
   */
  public static async deleteNotification(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const recipientId = getRecipientId(req);
      const notificationId = getNotificationId(req);

      const data = await notificationInboxService.deleteNotification(
        recipientId,
        notificationId,
      );

      setPrivateNoStore(res);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Notification deleted successfully.",
        data,
      ).send();
    } catch (error) {
      next(error);
    }
  }
}
