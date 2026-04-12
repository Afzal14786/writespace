import { Request, Response, NextFunction } from "express";
import { notificationService } from "./notification.service";
import { ApiResponse } from "@shared/utils/api-response";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import { AppError } from "@shared/utils/app.error";

export class NotificationController {
  
  /**
   * Fetch the logged-in user's notifications with pagination
   */
  public static async getNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Authentication required");
      }

      // Safely parse pagination query parameters
      const parsedLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const parsedOffset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

      const limit = isNaN(parsedLimit) ? 20 : parsedLimit;
      const offset = isNaN(parsedOffset) ? 0 : parsedOffset;

      const data = await notificationService.getUserNotifications(req.user.id, limit, offset);

      new ApiResponse(
        res, 
        HTTP_STATUS.OK, 
        "Notifications retrieved successfully", 
        data
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * Mark specific notifications as read
   */
  public static async markAsRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Authentication required");
      }

      const body = req.body as Record<string, unknown>;
      const notificationIds = body.notificationIds;

      if (!Array.isArray(notificationIds)) {
        throw new AppError(HTTP_STATUS.BAD_REQUEST, "notificationIds must be an array of numbers");
      }

      // STRICT TYPE SAFETY: Convert all incoming unknown IDs to numbers to satisfy Drizzle ORM's PgSerial type
      const numericIds = notificationIds
        .map((id: unknown) => Number(id))
        .filter((id: number) => !isNaN(id));

      if (numericIds.length === 0) {
        throw new AppError(HTTP_STATUS.BAD_REQUEST, "Valid notificationIds are required");
      }

      await notificationService.markAsRead(numericIds, req.user.id);

      new ApiResponse(
        res, 
        HTTP_STATUS.OK, 
        "Notifications marked as read",
        null
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * Mark all of a user's notifications as read instantly
   */
  public static async markAllAsRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Authentication required");
      }

      await notificationService.markAllAsRead(req.user.id);

      new ApiResponse(
        res, 
        HTTP_STATUS.OK, 
        "All notifications marked as read",
        null
      ).send();
    } catch (error) {
      next(error);
    }
  }
}