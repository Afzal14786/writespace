import { Queue } from "bullmq";

import env from "@config/env";
import { bullmqRedisConnection } from "@config/bullmq";

/**
 * Dedicated queue for notification delivery events.
 *
 * Jobs reference durable outbox records in PostgreSQL. The database
 * remains the source of truth for the delivery request.
 */
export const NOTIFICATION_DELIVERY_EVENTS_QUEUE_NAME =
  "notification-delivery-events-queue";

/**
 * Minimal queue payload.
 *
 * The delivery worker will load the outbox event and delivery record
 * from PostgreSQL before performing any channel-specific work.
 */
export interface NotificationDeliveryEventJobData {
  eventId: string;
}

export const notificationDeliveryEventsQueue =
  new Queue<NotificationDeliveryEventJobData>(
    NOTIFICATION_DELIVERY_EVENTS_QUEUE_NAME,
    {
      connection: bullmqRedisConnection,

      defaultJobOptions: {
        attempts: env.NOTIFICATION_QUEUE_ATTEMPTS,

        backoff: {
          type: "exponential",
          delay: env.QUEUE_BACKOFF_DELAY_MS,
        },

        removeOnComplete: {
          age: 24 * 60 * 60,
          count: 10_000,
        },

        removeOnFail: {
          age: 7 * 24 * 60 * 60,
          count: 50_000,
        },
      },
    },
  );
