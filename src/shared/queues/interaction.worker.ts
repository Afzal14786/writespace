import { Worker } from "bullmq";
import env from "../../config/env";
import { db } from "../../db";
import { notifications } from "../../db/schema";
import { IInteractionJob } from "./interaction.queue";
import logger from "../../config/logger";

export const interactionWorker = new Worker<IInteractionJob>(
  "interaction-queue",
  async (job) => {
    const { recipientId, type, message, relatedId } = job.data;

    await db.insert(notifications).values({
      recipientId,
      type,
      message,
      relatedId,
    });
  },
  {
    connection: {
      url: env.REDIS_URL,
      password: env.REDIS_PASSWORD,
    },
    concurrency: 10,
  },
);

interactionWorker.on("completed", (_job) => {});

interactionWorker.on("failed", (job, err) => {
  logger.error(`Interaction job ${job?.id} failed: ${err.message}`);
});
