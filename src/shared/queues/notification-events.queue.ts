import { Queue } from "bullmq";

import env from "@config/env";
import { bullmqRedisConnection } from "@config/bullmq";

/**
 * Dedicated queue for durable notification domain events.
 *
 * The legacy notification queue carries a complete notification payload.
 * This queue carries only a reference to an event persisted in PostgreSQL.
 */
export const NOTIFICATION_EVENTS_QUEUE_NAME = "notification-events-queue";

/**
 * Minimal BullMQ job payload.
 *
 * Do not add recipient details, email addresses, OTPs, reset tokens,
 * or complete event payloads here. PostgreSQL is the durable source
 * of truth for event data.
 */
export interface NotificationEventJobData {
  eventId: string;
}

/**
 * Queue-level retries cover consumer processing after BullMQ accepts
 * the event job.
 *
 * Outbox dispatch retries are managed separately by the dispatcher
 * and outbox_events table.
 */
export const notificationEventsQueue = new Queue<NotificationEventJobData>(
  NOTIFICATION_EVENTS_QUEUE_NAME,
  {
    connection: bullmqRedisConnection,

    defaultJobOptions: {
      attempts: env.NOTIFICATION_QUEUE_ATTEMPTS,
      backoff: {
        type: "exponential",
        delay: env.QUEUE_BACKOFF_DELAY_MS,
      },

      // Keep completed job IDs temporarily to reduce duplicate
      // handoffs. Database-backed consumer idempotency remains
      // authoritative after these jobs are removed.
      removeOnComplete: {
        age: 24 * 60 * 60,
        count: 10_000,
      },

      // Retain failed jobs for operational inspection.
      removeOnFail: {
        age: 7 * 24 * 60 * 60,
        count: 50_000,
      },
    },
  },
);
