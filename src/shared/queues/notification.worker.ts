import { Worker, type Job } from "bullmq";
import { eq } from "drizzle-orm";

import env from "@config/env";
import logger from "@config/logger";
import { bullmqRedisConnection } from "@config/bullmq";

import { db } from "../../db";
import { notifications, users } from "../../db/schema";

import {
  NOTIFICATION_QUEUE_NAME,
  type NotificationJobData,
} from "./notification.queue";

export const notificationWorker = new Worker<NotificationJobData>(
  NOTIFICATION_QUEUE_NAME,
  async (job: Job<NotificationJobData>) => {
    const { recipientId, type, message, relatedId, actorId } = job.data;

    let finalMessage = message;

    if (actorId) {
      const [actor] = await db
        .select({ fullname: users.fullname, username: users.username })
        .from(users)
        .where(eq(users.id, actorId))
        .limit(1);

      if (actor) {
        const displayName = actor.fullname || actor.username;
        finalMessage = `${displayName} ${message}`;
      }
    }

    await db.insert(notifications).values({
      recipientId,
      actorId: actorId || null,
      type,
      message: finalMessage,
      relatedId: relatedId || null,
    });
  },
  {
    connection: bullmqRedisConnection,
    concurrency: env.NOTIFICATION_WORKER_CONCURRENCY,
  },
);

notificationWorker.on("failed", (job, error) => {
  logger.error(`Notification job ${job?.id} failed: ${error.message}`);
});

notificationWorker.on("error", (error) => {
  logger.error("Notification worker error", { error });
});
