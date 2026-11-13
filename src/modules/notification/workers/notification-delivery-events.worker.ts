import { DelayedError, UnrecoverableError, Worker, type Job } from "bullmq";

import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import env from "@config/env";
import logger from "@config/logger";
import { bullmqRedisConnection } from "@config/bullmq";

import { HTTP_STATUS } from "@shared/constants/http-codes";
import { AppError } from "@shared/utils/app.error";

import {
  NOTIFICATION_DELIVERY_EVENTS_QUEUE_NAME,
  type NotificationDeliveryEventJobData,
} from "@shared/queues/notification-delivery-events.queue";

import {
  type NotificationDeliveryProcessResult,
  notificationDeliveryService,
} from "../services/notification-delivery.service";

import { notificationEmailHandler } from "../handlers/notification-email.handler";
import { notificationRealtimeHandler } from "../handlers/notification-realtime.handler";

/**
 * Validate the minimal event reference received from BullMQ.
 *
 * The actual delivery data is always loaded from PostgreSQL by the
 * notification delivery service.
 */
const notificationDeliveryJobSchema = z.strictObject({
  eventId: z.string().uuid(),
});

/**
 * Identify permanent contract or client/data errors.
 *
 * Infrastructure failures and unexpected server errors remain
 * recoverable through BullMQ retries.
 */
function isPermanentDeliveryError(error: unknown): error is AppError {
  if (!(error instanceof AppError)) {
    return false;
  }

  const isClientError = error.statusCode >= 400 && error.statusCode < 500;

  return isClientError && error.statusCode !== HTTP_STATUS.TOO_MANY_REQUESTS;
}

/**
 * A stable identity for this worker process's delivery leases.
 *
 * A different process receives a different ID, allowing expired leases
 * to be recovered after a process restart.
 */
const deliveryWorkerId = [hostname(), process.pid, randomUUID()].join("-");

/*
 * Register the currently implemented delivery channels.
 *
 * Email and real-time delivery are supported.
 * Browser push has not been implemented yet.
 */
notificationDeliveryService.registerHandler(notificationEmailHandler);
notificationDeliveryService.registerHandler(notificationRealtimeHandler);

/**
 * Dedicated worker for durable notification-delivery requests.
 *
 * Retry scheduling:
 * - RETRY_SCHEDULED: the delivery repository has persisted a retry time.
 * - WAITING: the delivery is not due yet or another worker owns its lease.
 *
 * Both states use BullMQ's delayed-job mechanism. The job is not marked
 * complete until the delivery reaches a terminal or acknowledged state.
 */
export const notificationDeliveryEventsWorker = new Worker<
  NotificationDeliveryEventJobData,
  NotificationDeliveryProcessResult
>(
  NOTIFICATION_DELIVERY_EVENTS_QUEUE_NAME,
  async (job: Job<NotificationDeliveryEventJobData>, token?: string) => {
    const parsedJob = notificationDeliveryJobSchema.safeParse(job.data);

    if (!parsedJob.success) {
      logger.error("Rejected notification delivery job payload", {
        jobId: job.id,
        validationIssues: parsedJob.error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
        })),
      });

      throw new UnrecoverableError(
        "Notification delivery job contains an invalid payload.",
      );
    }

    const { eventId } = parsedJob.data;

    let result: NotificationDeliveryProcessResult;

    try {
      result = await notificationDeliveryService.process(eventId, {
        workerId: deliveryWorkerId,

        /*
         * Reuse the validated outbox lease duration for the initial
         * delivery lease. A separate delivery-specific setting can be
         * introduced after measuring real channel durations.
         */
        leaseDurationMs: env.NOTIFICATION_DELIVERY_LEASE_DURATION_MS,

        attemptsMade: job.attemptsMade,
        maxAttempts: env.NOTIFICATION_QUEUE_ATTEMPTS,
        retryBaseDelayMs: env.QUEUE_BACKOFF_DELAY_MS,
      });
    } catch (error) {
      if (isPermanentDeliveryError(error)) {
        logger.error(
          "Notification delivery has a permanent processing failure",
          {
            jobId: job.id,
            eventId,
            statusCode: error.statusCode,
            error,
          },
        );

        throw new UnrecoverableError(error.message);
      }

      // Database, Redis and unexpected operational failures are retried.
      throw error;
    }

    /*
     * A retryable channel failure has already been recorded in
     * PostgreSQL. Move the same BullMQ job to the persisted retry time.
     *
     * This avoids creating a second logical delivery job.
     */
    if (result.status === "RETRY_SCHEDULED") {
      logger.warn("Notification delivery scheduled for retry", {
        jobId: job.id,
        eventId,
        deliveryId: result.deliveryId,
        retryAt: result.retryAt.toISOString(),
      });

      await moveJobToScheduledTime(job, token, result.retryAt);

      throw new DelayedError();
    }

    /*
     * WAITING is used when the delivery is not due yet or another
     * worker currently owns its lease.
     */
    if (result.status === "WAITING") {
      logger.info("Notification delivery is waiting", {
        jobId: job.id,
        eventId,
        deliveryId: result.deliveryId,
        retryAt: result.retryAt.toISOString(),
        reason: result.reason,
      });

      await moveJobToScheduledTime(job, token, result.retryAt);

      throw new DelayedError();
    }

    return result;
  },
  {
    connection: bullmqRedisConnection,
    concurrency: env.NOTIFICATION_WORKER_CONCURRENCY,
  },
);

/**
 * Move the active job to a future timestamp.
 *
 * BullMQ requires the current worker lock token and DelayedError so
 * that it does not try to complete the job after it has been delayed.
 */
async function moveJobToScheduledTime(
  job: Job<NotificationDeliveryEventJobData>,
  token: string | undefined,
  retryAt: Date,
): Promise<void> {
  if (!token) {
    throw new Error(
      "Cannot delay notification delivery job without its worker lock token.",
    );
  }

  // Avoid immediately reprocessing a timestamp that has already passed.
  const scheduledTimestamp = Math.max(retryAt.getTime(), Date.now() + 250);

  await job.moveToDelayed(scheduledTimestamp, token);
}

notificationDeliveryEventsWorker.on("completed", (job, result) => {
  logger.info("Notification delivery job completed", {
    jobId: job.id,
    eventId: job.data.eventId,
    result,
  });
});

notificationDeliveryEventsWorker.on("failed", (job, error) => {
  logger.error("Notification delivery job failed", {
    jobId: job?.id,
    eventId: job?.data?.eventId,
    attemptsMade: job?.attemptsMade,
    error,
  });
});

notificationDeliveryEventsWorker.on("error", (error) => {
  logger.error("Notification delivery worker error", {
    error,
  });
});
