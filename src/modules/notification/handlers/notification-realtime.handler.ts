import type {
  NotificationDeliveryContext,
  NotificationDeliveryHandler,
  NotificationDeliveryHandlerResult,
} from "../contracts/delivery-handler.contract";

import { notificationInboxService } from "../services/notification-inbox.service";

import {
  getNotificationSocketServer,
  getNotificationUserRoom,
} from "../realtime/notification-socket.server";

import { HTTP_STATUS } from "@shared/constants/http-codes";
import { AppError } from "@shared/utils/app.error";

import logger from "@config/logger";

/**
 * Real-time notification handler.
 *
 * Sends an existing inbox notification to the recipient's authenticated
 * private Socket.IO room.
 *
 * Important:
 * - PostgreSQL remains the source of truth.
 * - Socket.IO emission is best-effort.
 * - Transport acceptance does not guarantee browser receipt or rendering.
 */
export class NotificationRealtimeHandler implements NotificationDeliveryHandler {
  public readonly channel = "realtime" as const;

  public async deliver(
    context: NotificationDeliveryContext,
  ): Promise<NotificationDeliveryHandlerResult> {
    const { delivery, notification, outboxEvent } = context;

    // Real-time notifications require an existing inbox notification.
    if (!notification) {
      return {
        outcome: "suppressed",
        errorCode: "notification_realtime_record_unavailable",
      };
    }

    if (!delivery.recipientUserId) {
      return {
        outcome: "suppressed",
        errorCode: "notification_realtime_recipient_unavailable",
      };
    }

    /*
     * Verify recipient ownership again at the delivery boundary.
     * Never broadcast a notification to a different recipient.
     */
    if (notification.recipientUserId !== delivery.recipientUserId) {
      logger.error("Notification realtime recipient mismatch", {
        eventId: outboxEvent.id,
        deliveryId: delivery.id,
        notificationId: notification.id,
      });

      return {
        outcome: "permanent_failure",
        errorCode: "notification_realtime_recipient_mismatch",
      };
    }

    /*
     * The inbox lifecycle takes precedence over queued delivery work.
     *
     * A notification may have been dismissed, archived, deleted or expired
     * after its delivery request was created.
     */
    if (
      notification.status !== "active" ||
      notification.deletedAt !== null ||
      (notification.expiresAt !== null &&
        notification.expiresAt.getTime() <= Date.now())
    ) {
      return {
        outcome: "suppressed",
        errorCode: "notification_realtime_notification_inactive",
      };
    }

    /*
     * Reuse the REST inbox representation rather than exposing the raw
     * database row or duplicating notification formatting logic.
     *
     * A concurrent deletion can make this lookup return NOT_FOUND.
     */
    let notificationPayload: Awaited<
      ReturnType<typeof notificationInboxService.getNotification>
    >;

    try {
      notificationPayload = await notificationInboxService.getNotification(
        delivery.recipientUserId,
        notification.id,
      );
    } catch (error) {
      // Deletion between the initial lookup and this query is a normal race.
      if (
        error instanceof AppError &&
        error.statusCode === HTTP_STATUS.NOT_FOUND
      ) {
        return {
          outcome: "suppressed",
          errorCode: "notification_realtime_notification_unavailable",
        };
      }

      // Preserve unexpected errors for the delivery service to classify.
      throw error;
    }

    // Recheck lifecycle state after loading the current REST representation.
    if (
      notificationPayload.status !== "active" ||
      (notificationPayload.expiresAt !== null &&
        notificationPayload.expiresAt.getTime() <= Date.now())
    ) {
      return {
        outcome: "suppressed",
        errorCode: "notification_realtime_notification_inactive",
      };
    }

    /*
     * Complete all database reads before performing external emissions.
     *
     * This prevents an unread-count query failure from happening after
     * the notification has already been emitted.
     */
    const { unreadCount } = await notificationInboxService.getUnreadCount(
      delivery.recipientUserId,
    );

    const socketServer = getNotificationSocketServer();

    const recipientRoom = getNotificationUserRoom(delivery.recipientUserId);

    /*
     * The original source event identifies notification creation.
     * A different source event means an existing grouped notification
     * has received another activity update.
     */
    const eventName =
      notification.sourceEventId === delivery.sourceEventId
        ? "notification.created"
        : "notification.updated";

    // Emit the safe, frontend-friendly REST representation.
    socketServer.to(recipientRoom).emit(eventName, {
      notification: notificationPayload,
    });

    // Send the current unread count after the notification event.
    socketServer.to(recipientRoom).emit("notification.unread-count.updated", {
      unreadCount,
    });

    logger.info("Realtime notification accepted by Socket.IO", {
      eventId: outboxEvent.id,
      deliveryId: delivery.id,
      notificationId: notification.id,
      recipientUserId: delivery.recipientUserId,
      eventName,
    });

    return {
      outcome: "accepted",
      acceptedAt: new Date(),
    };
  }
}

export const notificationRealtimeHandler = new NotificationRealtimeHandler();
