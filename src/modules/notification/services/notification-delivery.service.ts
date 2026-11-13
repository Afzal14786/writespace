import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../../db";

import { notifications } from "../../../db/schema/notifications";
import { type Notification } from "../../../db/schema/notifications";

import type {
  NotificationDelivery,
  NotificationDeliveryStatus,
} from "../../../db/schema/notification-deliveries";

import {
  type CompleteNotificationDeliveryAttemptInput,
  notificationDeliveryRepository,
} from "../repositories/notification-delivery.repository";

import { outboxRepository } from "../repositories/outbox.repository";

import type {
  NotificationDeliveryHandler,
  NotificationDeliveryHandlerResult,
  NotificationDeliveryContext,
} from "../contracts/delivery-handler.contract";

import { NOTIFICATION_DELIVERY_REQUESTED_EVENT } from "../domain/delivery-event-name";

import { HTTP_STATUS } from "@shared/constants/http-codes";
import { AppError } from "@shared/utils/app.error";
import logger from "@config/logger";

/**
 * The internal delivery-request event contains only the durable
 * delivery record ID. It must never carry email addresses, rendered
 * message bodies or authentication secrets.
 */
const notificationDeliveryEventPayloadSchema = z.strictObject({
  deliveryId: z.string().uuid(),
});

export interface ProcessNotificationDeliveryOptions {
  workerId: string;

  leaseDurationMs: number;

  /**
   * BullMQ attemptsMade is zero-based inside the first processor run.
   */
  attemptsMade: number;

  maxAttempts: number;

  /**
   * Must match the exponential backoff delay configured on the queue.
   */
  retryBaseDelayMs: number;
}

export type NotificationDeliveryProcessResult =
  | {
      status: "PROCESSED";
      deliveryId: string;
      deliveryStatus: NotificationDeliveryStatus;
    }
  | {
      status: "RETRY_SCHEDULED";
      deliveryId: string;
      retryAt: Date;
    }
  | {
      status: "DEAD_LETTERED";
      deliveryId: string;
    }
  | {
      status: "WAITING";
      deliveryId: string;
      retryAt: Date;
      reason: string;
    }
  | {
      status: "SKIPPED";
      deliveryId: string;
      reason: string;
    }
  | {
      status: "LEASE_LOST";
      deliveryId: string;
    };

/**
 * Coordinates durable channel delivery.
 *
 * Responsibilities:
 * 1. Load and validate the delivery-request outbox event.
 * 2. Resolve the persisted delivery and notification records.
 * 3. Select the registered channel handler.
 * 4. Claim the delivery and create its attempt transactionally.
 * 5. Invoke the channel handler outside the database transaction.
 * 6. Persist the attempt outcome and latest delivery state.
 *
 * SMTP, WebSocket and browser-push implementations belong to their
 * respective channel handlers, not this service.
 */
export class NotificationDeliveryService {
  private readonly handlers = new Map<
    NotificationDelivery["channel"],
    NotificationDeliveryHandler
  >();

  /**
   * Register a channel handler.
   *
   * Only one handler may own a channel in a process. This prevents
   * accidental replacement of an already configured delivery adapter.
   */
  public registerHandler(handler: NotificationDeliveryHandler): void {
    if (this.handlers.has(handler.channel)) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        `A notification delivery handler is already registered for "${handler.channel}".`,
      );
    }

    this.handlers.set(handler.channel, handler);

    logger.info("Notification delivery handler registered", {
      channel: handler.channel,
    });
  }

  /**
   * Process one durable delivery-request event.
   *
   * This method does not trust the BullMQ job as the source of delivery
   * data. The event and delivery are both reloaded from PostgreSQL.
   */
  public async process(
    eventId: string,
    options: ProcessNotificationDeliveryOptions,
  ): Promise<NotificationDeliveryProcessResult> {
    this.validateProcessingOptions(options);

    const outboxEvent = await db.transaction(async (transaction) => {
      return outboxRepository.findById(transaction, eventId);
    });

    if (!outboxEvent) {
      throw new AppError(
        HTTP_STATUS.UNPROCESSABLE_ENTITY,
        "Notification delivery outbox event was not found.",
      );
    }

    if (
      outboxEvent.eventName !== NOTIFICATION_DELIVERY_REQUESTED_EVENT ||
      outboxEvent.eventVersion !== 1 ||
      outboxEvent.aggregateType !== "notification_delivery"
    ) {
      throw new AppError(
        HTTP_STATUS.UNPROCESSABLE_ENTITY,
        "Outbox event is not a supported notification delivery request.",
      );
    }

    const parsedPayload = notificationDeliveryEventPayloadSchema.safeParse(
      outboxEvent.payload,
    );

    if (!parsedPayload.success) {
      throw new AppError(
        HTTP_STATUS.UNPROCESSABLE_ENTITY,
        "Notification delivery event contains an invalid payload.",
      );
    }

    const { deliveryId } = parsedPayload.data;

    if (outboxEvent.aggregateId !== deliveryId) {
      throw new AppError(
        HTTP_STATUS.UNPROCESSABLE_ENTITY,
        "Notification delivery event aggregate does not match its payload.",
      );
    }

    const delivery = await notificationDeliveryRepository.findById(deliveryId);

    if (!delivery) {
      throw new AppError(
        HTTP_STATUS.UNPROCESSABLE_ENTITY,
        "Notification delivery record referenced by the event was not found.",
      );
    }

    const notification = await this.findNotification(delivery);

    const context: NotificationDeliveryContext = {
      outboxEvent,
      delivery,
      notification,
    };

    const handler = this.handlers.get(delivery.channel);

    /*
     * Do not claim the delivery if its channel is not configured.
     *
     * This is a configuration/readiness problem, not a delivery attempt.
     */
    if (!handler) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        `No notification delivery handler is registered for channel "${delivery.channel}".`,
      );
    }

    const claim = await notificationDeliveryRepository.claimForProcessing({
      deliveryId,
      workerId: options.workerId,
      leaseDurationMs: options.leaseDurationMs,
    });

    if (!claim) {
      return this.resolveUnclaimedDelivery(deliveryId);
    }

    let handlerResult: NotificationDeliveryHandlerResult;
    let leaseLost = false;

    let heartbeatInFlight: Promise<void> | null = null;

    /*
     * Renew the delivery lease while the channel handler is running.
     *
     * A heartbeat runs every one-third of the lease duration. This gives
     * the worker multiple opportunities to renew before its current lease
     * expires, without allowing overlapping renewal requests.
     */
    const heartbeatIntervalMs = Math.max(
      1,
      Math.floor(options.leaseDurationMs / 3),
    );

    const renewDeliveryLease = async (): Promise<void> => {
      try {
        const renewedDelivery = await notificationDeliveryRepository.renewLease(
          {
            deliveryId,
            workerId: options.workerId,
            attemptNumber: claim.attempt.attemptNumber,
            leaseDurationMs: options.leaseDurationMs,
          },
        );

        if (!renewedDelivery) {
          /*
           * The repository confirms that this worker no longer owns
           * the active delivery attempt. Stop further renewal attempts.
           */
          leaseLost = true;

          logger.warn("Notification delivery lease ownership was lost", {
            eventId,
            deliveryId,
            workerId: options.workerId,
            attemptNumber: claim.attempt.attemptNumber,
          });
        }
      } catch (error) {
        /*
         * A temporary database error does not by itself prove that
         * ownership has been lost. A later heartbeat may still succeed.
         *
         * The final completion operation independently verifies that
         * the lease is valid before persisting the handler result.
         */
        logger.error("Notification delivery lease renewal failed", {
          eventId,
          deliveryId,
          workerId: options.workerId,
          attemptNumber: claim.attempt.attemptNumber,
          error,
        });
      }
    };

    const heartbeatTimer = setInterval(() => {
      // Never overlap renewal operations or renew after losing ownership.
      if (leaseLost || heartbeatInFlight) {
        return;
      }

      heartbeatInFlight = renewDeliveryLease().finally(() => {
        heartbeatInFlight = null;
      });
    }, heartbeatIntervalMs);

    try {
      handlerResult = await handler.deliver({
        ...context,
        delivery: claim.delivery,
      });
    } catch (error) {
      /*
       * An unexpected transport exception does not prove that the
       * external action failed before taking effect.
       *
       * Record the uncertainty instead of blindly retrying and
       * potentially sending duplicate emails or live updates.
       */
      logger.error("Notification delivery handler threw unexpectedly", {
        eventId,
        deliveryId,
        channel: delivery.channel,
        attemptNumber: claim.attempt.attemptNumber,
        error,
      });

      handlerResult = {
        outcome: "ambiguous",
        errorCode: "delivery_handler_unexpected_error",
      };
    } finally {
      // No heartbeat should continue once the handler has finished.
      clearInterval(heartbeatTimer);

      /*
       * Allow any already-running renewal to finish before attempting
       * to persist the delivery outcome.
       */
      if (heartbeatInFlight) {
        await heartbeatInFlight;
      }
    }

    /*
     * Do not attempt completion after a heartbeat has confirmed
     * that this worker has lost ownership.
     *
     * The previous handler may still have performed its external action.
     */
    if (leaseLost) {
      return {
        status: "LEASE_LOST",
        deliveryId,
      };
    }

    return this.persistHandlerResult({
      deliveryId,
      workerId: options.workerId,
      attemptNumber: claim.attempt.attemptNumber,
      handlerResult,
      options,
    });
  }

  /**
   * Load the persistent inbox notification, when this delivery
   * is associated with one.
   *
   * Email-only deliveries may have no notification record.
   */
  private async findNotification(
    delivery: NotificationDelivery,
  ): Promise<Notification | null> {
    if (!delivery.notificationId) {
      return null;
    }

    const [notification] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, delivery.notificationId))
      .limit(1);

    return notification ?? null;
  }

  /**
   * Persist the handler result and map it to the durable delivery state.
   *
   * Transient failures are scheduled for retry only when the queue
   * still has attempts remaining. The retry timestamp uses the same
   * exponential delay as the configured BullMQ queue.
   */
  private async persistHandlerResult(input: {
    deliveryId: string;
    workerId: string;
    attemptNumber: number;
    handlerResult: NotificationDeliveryHandlerResult;
    options: ProcessNotificationDeliveryOptions;
  }): Promise<NotificationDeliveryProcessResult> {
    const { deliveryId, workerId, attemptNumber, handlerResult, options } =
      input;

    let status: NotificationDeliveryStatus;
    let nextAttemptAt: Date | undefined;

    switch (handlerResult.outcome) {
      case "accepted":
        status = "accepted";
        break;

      case "delivered":
        status = "delivered";
        break;

      case "transient_failure": {
        // The database attempt number is authoritative because manually delayed
        // BullMQ jobs do not increment attemptsMade.
        const retryRemains = attemptNumber < options.maxAttempts;

        if (retryRemains) {
          status = "retryable_failed";

          const retryDelayMs =
            options.retryBaseDelayMs * 2 ** (attemptNumber - 1);

          if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 1) {
            throw new AppError(
              HTTP_STATUS.INTERNAL_SERVER_ERROR,
              "Calculated notification delivery retry delay is invalid.",
            );
          }

          nextAttemptAt = new Date(Date.now() + retryDelayMs);
        } else {
          status = "dead_lettered";
        }

        break;
      }

      case "permanent_failure":
        status = "permanent_failed";
        break;

      case "ambiguous":
        status = "unknown";
        break;

      case "suppressed":
        status = "suppressed";
        break;

      default: {
        const exhaustiveCheck: never = handlerResult.outcome;
        throw new AppError(
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          `Unsupported notification delivery outcome: ${String(exhaustiveCheck)}`,
        );
      }
    }

    const completionInput: CompleteNotificationDeliveryAttemptInput = {
      deliveryId,
      workerId,
      attemptNumber,
      outcome: handlerResult.outcome,
      status,
      nextAttemptAt,
      errorCode: handlerResult.errorCode ?? null,
      providerResponseCode: handlerResult.providerResponseCode,
      providerMessageId: handlerResult.providerMessageId,
      acceptedAt: handlerResult.acceptedAt,
      confirmedDeliveredAt: handlerResult.confirmedDeliveredAt,
    };

    const updatedDelivery =
      await notificationDeliveryRepository.completeAttempt(completionInput);

    /*
     * The lease may have expired and another worker may have resolved
     * the delivery while this handler was still running.
     *
     * Do not allow this stale worker to overwrite the newer state.
     */
    if (!updatedDelivery) {
      logger.warn(
        "Notification delivery result was not persisted because its lease was lost",
        {
          deliveryId,
          workerId,
          attemptNumber,
        },
      );

      return {
        status: "LEASE_LOST",
        deliveryId,
      };
    }

    if (status === "retryable_failed" && nextAttemptAt) {
      return {
        status: "RETRY_SCHEDULED",
        deliveryId,
        retryAt: nextAttemptAt,
      };
    }

    if (status === "dead_lettered") {
      logger.error(
        "Notification delivery exhausted its automatic retry attempts",
        {
          deliveryId,
          channel: updatedDelivery.channel,
          attemptCount: updatedDelivery.attemptCount,
          errorCode: handlerResult.errorCode,
        },
      );

      return {
        status: "DEAD_LETTERED",
        deliveryId,
      };
    }

    return {
      status: "PROCESSED",
      deliveryId,
      deliveryStatus: updatedDelivery.status,
    };
  }

  /**
   * A claim can return null because:
   * - another worker owns a valid lease;
   * - the delivery is not due yet;
   * - the delivery is already terminal;
   * - the eligibility decision prevents delivery;
   * - an expired lease was changed to unknown.
   *
   * Distinguish waiting work from terminal work so the worker can
   * reschedule or acknowledge it appropriately.
   */
  private async resolveUnclaimedDelivery(
    deliveryId: string,
  ): Promise<NotificationDeliveryProcessResult> {
    const delivery = await notificationDeliveryRepository.findById(deliveryId);

    if (!delivery) {
      return {
        status: "SKIPPED",
        deliveryId,
        reason: "delivery_not_found",
      };
    }

    const now = Date.now();

    if (
      delivery.status === "processing" &&
      delivery.leaseExpiresAt &&
      delivery.leaseExpiresAt.getTime() > now
    ) {
      return {
        status: "WAITING",
        deliveryId,
        retryAt: delivery.leaseExpiresAt,
        reason: "another_worker_holds_the_delivery_lease",
      };
    }

    const futureTimes = [delivery.scheduledFor, delivery.nextAttemptAt]
      .filter((date): date is Date => date !== null)
      .filter((date) => date.getTime() > now);

    if (futureTimes.length > 0) {
      const retryAt = new Date(
        Math.max(...futureTimes.map((date) => date.getTime())),
      );

      return {
        status: "WAITING",
        deliveryId,
        retryAt,
        reason: "delivery_is_not_due_yet",
      };
    }

    return {
      status: "SKIPPED",
      deliveryId,
      reason: `delivery_not_claimable:${delivery.status}:${delivery.eligibilityDecision}`,
    };
  }

  private validateProcessingOptions(
    options: ProcessNotificationDeliveryOptions,
  ): void {
    if (!options.workerId.trim()) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Delivery worker ID must not be empty.",
      );
    }

    const positiveIntegerFields: Array<
      keyof Pick<
        ProcessNotificationDeliveryOptions,
        "leaseDurationMs" | "maxAttempts" | "retryBaseDelayMs"
      >
    > = ["leaseDurationMs", "maxAttempts", "retryBaseDelayMs"];

    for (const field of positiveIntegerFields) {
      const value = options[field];

      if (!Number.isSafeInteger(value) || value < 1) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          `${field} must be a positive safe integer.`,
        );
      }
    }

    if (
      !Number.isSafeInteger(options.attemptsMade) ||
      options.attemptsMade < 0
    ) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Delivery attemptsMade must be a non-negative safe integer.",
      );
    }

    if (options.attemptsMade >= options.maxAttempts) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Delivery attemptsMade cannot be greater than or equal to maxAttempts.",
      );
    }
  }
}

export const notificationDeliveryService = new NotificationDeliveryService();
