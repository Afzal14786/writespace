import { Queue } from "bullmq";
import env from "@config/env";
import { bullmqRedisConnection } from "@config/bullmq";
import type { NotificationType } from "@modules/notification/interface/notification.interface";

export const NOTIFICATION_QUEUE_NAME = "notification-queue";

export interface NotificationJobData {
  type: NotificationType;
  recipientId: string;
  actorId?: string;
  relatedId?: string;
  message: string;
}

export const notificationQueue = new Queue<NotificationJobData>(
  NOTIFICATION_QUEUE_NAME,
  {
    connection: bullmqRedisConnection,
    defaultJobOptions: {
      attempts: env.NOTIFICATION_QUEUE_ATTEMPTS,
      backoff: {
        type: "fixed",
        delay: env.QUEUE_BACKOFF_DELAY_MS,
      },
      removeOnComplete: true,
      removeOnFail: false,
    },
  },
);

export const addNotificationJob = async (
  job: NotificationJobData,
): Promise<void> => {
  await notificationQueue.add("process-notification", job);
};
