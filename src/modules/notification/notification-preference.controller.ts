import type { Request, Response, NextFunction } from "express";
import { z } from "zod";

import { ApiResponse } from "@shared/utils/api-response";
import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";

import { notificationPreferenceService } from "./services/notification-preference.service";

/**
 * Only category-level in-app preference changes are currently supported.
 *
 * Strict validation prevents clients from silently submitting unsupported
 * fields such as email, browser-push, or digest preferences.
 */
const updatePreferencesSchema = z
  .object({
    updates: z
      .array(
        z
          .object({
            category: z.string().trim().min(1).max(100),
            enabled: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

function getRecipientId(req: Request): string {
  if (!req.user) {
    throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Authentication required.");
  }

  return req.user.id;
}

function setPrivateNoStore(res: Response): void {
  res.setHeader("Cache-Control", "private, no-store");
}

export class NotificationPreferenceController {
  /**
   * GET /notification-preferences
   *
   * Returns the recipient's effective in-app preferences, including
   * policy defaults and any user-specific overrides.
   */
  public static async getPreferences(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const recipientId = getRecipientId(req);

      const data =
        await notificationPreferenceService.getPreferences(recipientId);

      setPrivateNoStore(res);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Notification preferences retrieved successfully.",
        data,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /notification-preferences
   *
   * Updates one or more in-app category preferences.
   * The service validates policy eligibility and applies updates atomically.
   */
  public static async updatePreferences(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const recipientId = getRecipientId(req);
      const parsedBody = updatePreferencesSchema.safeParse(req.body);

      if (!parsedBody.success) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "Invalid notification preference payload.",
        );
      }

      const data = await notificationPreferenceService.updatePreferences(
        recipientId,
        parsedBody.data,
      );

      setPrivateNoStore(res);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Notification preferences updated successfully.",
        data,
      ).send();
    } catch (error) {
      next(error);
    }
  }
}
