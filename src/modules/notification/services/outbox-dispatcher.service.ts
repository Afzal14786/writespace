import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

import logger from "@config/logger";

import { HTTP_STATUS } from "@shared/constants/http-codes";
import { AppError } from "@shared/utils/app.error";

import type { OutboxEvent } from "../../../db/schema/outbox-events";

import { notificationEventsQueue } from "@shared/queues/notification-events.queue";
import { notificationDeliveryEventsQueue } from "@shared/queues/notification-delivery-events.queue";

import { outboxRepository } from "../repositories/outbox.repository";

import { NOTIFICATION_DELIVERY_REQUESTED_EVENT } from "../domain/delivery-event-name";

/**
 * Runtime policy for one dispatcher batch.
 */
export interface OutboxDispatcherOptions {
  batchSize: number;
  leaseDurationMs: number;
  maxAttempts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
}

/**
 * Summary returned after one dispatcher batch.
 */
export interface OutboxDispatchBatchResult {
  claimed: number;
  published: number;
  failed: number;
  ownershipLost: number;
}

/**
 * Build a bounded exponential retry delay with jitter.
 *
 * Jitter avoids having multiple dispatcher instances retry their failed
 * events at exactly the same time after a shared infrastructure outage.
 */
function calculateRetryDelay(
  attemptCount: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const exponent = Math.max(0, attemptCount - 1);
  const boundedExponent = Math.min(exponent, 30);

  const exponentialDelay = Math.min(
    baseDelayMs * 2 ** boundedExponent,
    maxDelayMs,
  );

  // Add up to 20% positive jitter without exceeding the configured cap.
  const jitter = Math.floor(Math.random() * exponentialDelay * 0.2);

  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/**
 * Convert an unknown thrown value into a bounded message suitable for
 * the outbox lastError field.
 *
 * Stack traces and event payloads are deliberately not stored here.
 */
function getErrorMessage(error: unknown): string {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  return message
    .replace(
      /(redis|rediss|postgres|postgresql):\/\/[^@\s]+@/gi,
      "$1://[REDACTED]@",
    )
    .slice(0, 4000);
}

/**
 * Publishes claimed outbox events to their appropriate BullMQ queues.
 *
 * This is an at-least-once handoff. PostgreSQL and Redis do not share
 * a distributed transaction.
 *
 * Consumer-side database idempotency remains authoritative.
 */
export class OutboxDispatcherService {
  private readonly workerId = [hostname(), process.pid, randomUUID()].join("-");

  /**
   * Claim and dispatch one bounded batch.
   */
  public async dispatchBatch(
    options: OutboxDispatcherOptions,
  ): Promise<OutboxDispatchBatchResult> {
    this.validateOptions(options);

    const claimedEvents = await outboxRepository.claimBatch({
      workerId: this.workerId,
      batchSize: options.batchSize,
      leaseDurationMs: options.leaseDurationMs,
    });

    const result: OutboxDispatchBatchResult = {
      claimed: claimedEvents.length,
      published: 0,
      failed: 0,
      ownershipLost: 0,
    };

    for (const event of claimedEvents) {
      const dispatchStatus = await this.dispatchOne(event, options);

      if (dispatchStatus === "PUBLISHED") {
        result.published += 1;
      } else if (dispatchStatus === "FAILED") {
        result.failed += 1;
      } else {
        result.ownershipLost += 1;
      }
    }

    if (result.claimed > 0) {
      logger.info("Outbox dispatch batch completed", result);
    }

    return result;
  }

  /**
   * Select the destination queue using the persisted event name.
   *
   * The queue payload only contains the durable outbox event ID.
   */
  private async publishToQueue(event: OutboxEvent): Promise<void> {
    if (event.eventName === NOTIFICATION_DELIVERY_REQUESTED_EVENT) {
      await notificationDeliveryEventsQueue.add(
        "process-notification-delivery-event",
        {
          eventId: event.id,
        },
        {
          jobId: `notification-delivery-event-${event.id}`,
        },
      );

      return;
    }

    // Existing product domain events continue to use the original queue.
    await notificationEventsQueue.add(
      "process-notification-event",
      {
        eventId: event.id,
      },
      {
        jobId: `notification-event-${event.id}`,
      },
    );
  }

  /**
   * Hand off one claimed event to its destination queue, then persist
   * the publication result.
   */
  private async dispatchOne(
    event: OutboxEvent,
    options: OutboxDispatcherOptions,
  ): Promise<"PUBLISHED" | "FAILED" | "OWNERSHIP_LOST"> {
    try {
      await this.publishToQueue(event);

      const markedPublished = await outboxRepository.markPublished(
        event.id,
        this.workerId,
      );

      if (!markedPublished) {
        logger.warn("Outbox event lease was lost after queue handoff", {
          eventId: event.id,
          eventName: event.eventName,
        });

        return "OWNERSHIP_LOST";
      }

      return "PUBLISHED";
    } catch (error) {
      const errorMessage = getErrorMessage(error);

      const retryDelayMs = calculateRetryDelay(
        event.attemptCount,
        options.backoffBaseMs,
        options.backoffMaxMs,
      );

      const retryAt = new Date(Date.now() + retryDelayMs);

      try {
        const failureRecorded = await outboxRepository.markDispatchFailure({
          eventId: event.id,
          workerId: this.workerId,
          attemptCount: event.attemptCount,
          maxAttempts: options.maxAttempts,
          errorMessage,
          retryAt,
        });

        if (!failureRecorded) {
          logger.warn(
            "Could not record outbox dispatch failure because the lease was lost",
            {
              eventId: event.id,
              eventName: event.eventName,
            },
          );

          return "OWNERSHIP_LOST";
        }

        logger.error("Outbox event handoff failed", {
          eventId: event.id,
          eventName: event.eventName,
          attemptCount: event.attemptCount,
          maxAttempts: options.maxAttempts,
          retryAt: retryAt.toISOString(),
          error,
        });

        return "FAILED";
      } catch (recordError) {
        // If PostgreSQL is unavailable, the row remains PROCESSING.
        // Its lease will eventually expire and another dispatcher can reclaim it.
        logger.error("Failed to record outbox dispatch failure", {
          eventId: event.id,
          eventName: event.eventName,
          dispatchError: error,
          persistenceError: recordError,
        });

        return "OWNERSHIP_LOST";
      }
    }
  }

  /**
   * Validate dispatcher configuration before claiming database rows.
   */
  private validateOptions(options: OutboxDispatcherOptions): void {
    const positiveValues: Array<[string, number]> = [
      ["batchSize", options.batchSize],
      ["leaseDurationMs", options.leaseDurationMs],
      ["maxAttempts", options.maxAttempts],
      ["backoffBaseMs", options.backoffBaseMs],
      ["backoffMaxMs", options.backoffMaxMs],
    ];

    for (const [name, value] of positiveValues) {
      if (!Number.isInteger(value) || value < 1) {
        throw new AppError(
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          `Outbox dispatcher configuration "${name}" must be a positive integer.`,
        );
      }
    }

    if (options.backoffMaxMs < options.backoffBaseMs) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Outbox dispatcher configuration backoffMaxMs cannot be smaller than backoffBaseMs.",
      );
    }
  }
}

export const outboxDispatcherService = new OutboxDispatcherService();
