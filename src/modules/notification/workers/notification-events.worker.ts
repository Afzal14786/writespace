import { UnrecoverableError, Worker, type Job } from "bullmq";

import { z } from "zod";

import env from "@config/env";
import logger from "@config/logger";
import { bullmqRedisConnection } from "@config/bullmq";

import { HTTP_STATUS } from "@shared/constants/http-codes";
import { AppError } from "@shared/utils/app.error";

import {
  NOTIFICATION_EVENTS_QUEUE_NAME,
  type NotificationEventJobData,
} from "@shared/queues/notification-events.queue";

import type { NotificationProcessResult } from "../services/notification-processor.service";
import { notificationProcessorService } from "../services/notification-processor.service";

/**
 * Validate job data at the Redis/BullMQ boundary.
 *
 * TypeScript types cannot guarantee that previously stored Redis job data
 * is valid, so every worker must validate its incoming payload.
 */
const notificationEventJobSchema = z.strictObject({
  eventId: z.string().uuid(),
});

/**
 * Only permanent client/data/contract failures should bypass retries.
 *
 * Rate limiting is excluded because it may be temporary. Unexpected errors
 * and 5xx AppErrors are also allowed to propagate to BullMQ.
 */
function isPermanentProcessingError(error: unknown): error is AppError {
  if (!(error instanceof AppError)) {
    return false;
  }

  const isClientError = error.statusCode >= 400 && error.statusCode < 500;

  return isClientError && error.statusCode !== HTTP_STATUS.TOO_MANY_REQUESTS;
}

/**
 * Dedicated worker for durable notification events.
 *
 * Permanent application/data failures are converted into BullMQ's
 * UnrecoverableError so the same invalid event is not retried needlessly.
 *
 * Transient database, Redis or unexpected operational failures propagate
 * normally and use the queue's configured retry/backoff policy.
 */
export const notificationEventsWorker = new Worker<
  NotificationEventJobData,
  NotificationProcessResult
>(
  NOTIFICATION_EVENTS_QUEUE_NAME,
  async (job: Job<NotificationEventJobData>) => {
    const parsedJob = notificationEventJobSchema.safeParse(job.data);

    if (!parsedJob.success) {
      const appError = new AppError(
        HTTP_STATUS.UNPROCESSABLE_ENTITY,
        "Notification event job contains an invalid payload.",
      );

      logger.error("Rejected notification event job payload", {
        jobId: job.id,
        validationIssues: parsedJob.error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
        })),
        error: appError,
      });

      throw new UnrecoverableError(appError.message);
    }

    const { eventId } = parsedJob.data;

    try {
      return await notificationProcessorService.process(eventId);
    } catch (error) {
      if (isPermanentProcessingError(error)) {
        logger.error("Notification event has a permanent processing failure", {
          jobId: job.id,
          eventId,
          statusCode: error.statusCode,
          error,
        });

        throw new UnrecoverableError(error.message);
      }

      // Preserve transient/infrastructure failures. BullMQ will retry them
      // according to the queue's attempts and backoff configuration.
      throw error;
    }
  },
  {
    connection: bullmqRedisConnection,
    concurrency: env.NOTIFICATION_WORKER_CONCURRENCY,
  },
);

notificationEventsWorker.on("completed", (job, result) => {
  logger.info("Notification event job completed", {
    jobId: job.id,
    eventId: job.data.eventId,
    result,
  });
});

notificationEventsWorker.on("failed", (job, error) => {
  logger.error("Notification event job failed", {
    jobId: job?.id,
    eventId: job?.data?.eventId,
    attemptsMade: job?.attemptsMade,
    error,
  });
});

notificationEventsWorker.on("error", (error) => {
  logger.error("Notification event worker error", {
    error,
  });
});
