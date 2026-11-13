import { z } from "zod";

import { HTTP_STATUS } from "@shared/constants/http-codes";
import { AppError } from "@shared/utils/app.error";

import type { NotificationStatus } from "../../../db/schema/notifications";

import {
  notificationRepository,
  type NotificationInboxCursor,
} from "../repositories/notification.repository";

export interface GetNotificationInboxInput {
  limit: number;
  cursor?: string;
  view?: NotificationStatus;
  unread?: boolean;
  type?: string;
  category?: string;
}

const cursorSchema = z
  .object({
    createdAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
      .refine((value) => !Number.isNaN(Date.parse(value))),
    id: z.string().uuid(),
  })
  .strict();

/**
 * Decode and validate an opaque inbox cursor.
 *
 * Cursors control pagination only. They never establish ownership.
 */
function decodeCursor(value: string): NotificationInboxCursor {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const parsedJson: unknown = JSON.parse(decoded);
    const parsedCursor = cursorSchema.safeParse(parsedJson);

    if (!parsedCursor.success) {
      throw new Error("Invalid cursor structure");
    }

    return parsedCursor.data;
  } catch {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      "Invalid notification pagination cursor.",
    );
  }
}

function encodeCursor(cursor: NotificationInboxCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/**
 * User-facing notification inbox operations.
 *
 * This service manages persisted inbox state. It does not send email
 * or process domain events.
 */
export class NotificationInboxService {
  /**
   * Retrieve a paginated notification inbox.
   *
   * One extra row is fetched to determine whether another page exists.
   */
  public async getInbox(recipientId: string, input: GetNotificationInboxInput) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Notification limit must be between 1 and 50.",
      );
    }

    const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;

    const [rows, unreadCount] = await Promise.all([
      notificationRepository.listInbox({
        recipientId,
        limit: input.limit + 1,
        cursor,
        view: input.view ?? "active",
        unread: input.unread,
        type: input.type,
        category: input.category,
      }),

      // The bell count always represents the active inbox,
      // even when the user is viewing archived or dismissed items.
      notificationRepository.countUnreadForRecipient(recipientId),
    ]);

    const hasMore = rows.length > input.limit;
    const pageRows = rows.slice(0, input.limit);
    const lastRow = pageRows[pageRows.length - 1];

    const nextCursor =
      hasMore && lastRow
        ? encodeCursor({
            createdAt: lastRow.cursorCreatedAt,
            id: lastRow.id,
          })
        : null;

    const formattedNotifications = pageRows.map((row) => ({
      id: row.id,
      type: row.notificationType,
      category: row.category,
      priority: row.priority,
      title: row.title,
      body: row.body,

      presentationData: row.presentationData,

      resource:
        row.resourceType && row.resourceId
          ? {
              type: row.resourceType,
              id: row.resourceId,
            }
          : null,

      action: row.actionType
        ? {
            type: row.actionType,
            resourceType: row.resourceType,
            resourceId: row.resourceId,
          }
        : null,

      actor: row.actorId
        ? {
            id: row.actorId,
            username: row.actorUsername,
            displayName: row.actorFullname,
            profileImageUrl: row.actorProfileImageUrl,
          }
        : null,

      group: row.groupId
        ? {
            count: row.groupCount ?? 1,
            lastActivityAt: row.groupLastActivityAt,
          }
        : null,

      readAt: row.readAt,
      status: row.status,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    }));

    return {
      notifications: formattedNotifications,
      page: {
        nextCursor,
        hasMore,
      },
      unreadCount,
    };
  }

  public async getUnreadCount(recipientId: string) {
    const unreadCount =
      await notificationRepository.countUnreadForRecipient(recipientId);

    return { unreadCount };
  }

  public async getNotification(recipientId: string, notificationId: string) {
    const notification = await notificationRepository.findForRecipient(
      recipientId,
      notificationId,
    );

    if (!notification) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Notification not found.");
    }

    return {
      id: notification.id,
      type: notification.notificationType,
      category: notification.category,
      priority: notification.priority,
      title: notification.title,
      body: notification.body,
      presentationData: notification.presentationData,

      resource:
        notification.resourceType && notification.resourceId
          ? {
              type: notification.resourceType,
              id: notification.resourceId,
            }
          : null,

      action: notification.actionType
        ? {
            type: notification.actionType,
            resourceType: notification.resourceType,
            resourceId: notification.resourceId,
          }
        : null,

      actor: notification.actorId
        ? {
            id: notification.actorId,
            username: notification.actorUsername,
            displayName: notification.actorFullname,
            profileImageUrl: notification.actorProfileImageUrl,
          }
        : null,

      group: notification.groupId
        ? {
            count: notification.groupCount ?? 1,
            lastActivityAt: notification.groupLastActivityAt,
          }
        : null,

      readAt: notification.readAt,
      status: notification.status,
      expiresAt: notification.expiresAt,
      createdAt: notification.createdAt,
      updatedAt: notification.updatedAt,
    };
  }

  public async markAsRead(recipientId: string, notificationId: string) {
    const notification = await notificationRepository.markAsReadForRecipient(
      recipientId,
      notificationId,
    );

    if (!notification) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Notification not found.");
    }

    return {
      id: notification.id,
      readAt: notification.readAt,
      updatedAt: notification.updatedAt,
    };
  }

  public async markAllAsRead(recipientId: string) {
    const updatedCount =
      await notificationRepository.markAllAsReadForRecipient(recipientId);

    return { updatedCount };
  }

  /**
   * Remove an active notification from the recipient's inbox.
   */
  public async dismiss(recipientId: string, notificationId: string) {
    const result = await notificationRepository.dismissForRecipient(
      recipientId,
      notificationId,
    );

    if (result.outcome === "not_found") {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Notification not found.");
    }

    if (result.outcome === "invalid_state") {
      throw new AppError(
        HTTP_STATUS.CONFLICT,
        "Only active notifications can be dismissed.",
      );
    }

    const notification = result.notification;

    return {
      id: notification.id,
      status: notification.status,
      readAt: notification.readAt,
      updatedAt: notification.updatedAt,
    };
  }

  /**
   * Restore a dismissed or legacy archived notification to the active inbox.
   */
  public async restore(recipientId: string, notificationId: string) {
    const result = await notificationRepository.restoreForRecipient(
      recipientId,
      notificationId,
    );

    if (result.outcome === "not_found") {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Notification not found.");
    }

    if (result.outcome === "invalid_state") {
      throw new AppError(
        HTTP_STATUS.CONFLICT,
        "This notification cannot be restored.",
      );
    }

    const notification = result.notification;

    return {
      id: notification.id,
      status: notification.status,
      readAt: notification.readAt,
      updatedAt: notification.updatedAt,
    };
  }

  /**
   * Soft-delete a notification from the recipient's inbox.
   *
   * Repeated deletion by the owner returns the existing deleted state.
   */
  public async deleteNotification(recipientId: string, notificationId: string) {
    const result = await notificationRepository.deleteForRecipient(
      recipientId,
      notificationId,
    );

    if (result.outcome === "not_found") {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Notification not found.");
    }

    if (result.outcome === "invalid_state") {
      throw new AppError(
        HTTP_STATUS.CONFLICT,
        "This notification cannot be deleted.",
      );
    }

    const notification = result.notification;

    return {
      id: notification.id,
      status: notification.status,
      deletedAt: notification.deletedAt,
      updatedAt: notification.updatedAt,
    };
  }
}

export const notificationInboxService = new NotificationInboxService();
