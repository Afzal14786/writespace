import { Queue } from "bullmq";
import env from "@config/env";
import { bullmqRedisConnection } from "@config/bullmq";

export const MEDIA_QUEUE_NAME = "media-cleanup";

export interface MediaCleanupJobData {
  publicIds: string[];
}

export const mediaQueue = new Queue<MediaCleanupJobData>(MEDIA_QUEUE_NAME, {
  connection: bullmqRedisConnection,
  defaultJobOptions: {
    attempts: env.MEDIA_QUEUE_ATTEMPTS,
    backoff: {
      type: "exponential",
      delay: env.QUEUE_BACKOFF_DELAY_MS,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

export const addMediaCleanupJob = async (
  publicIds: string[],
): Promise<void> => {
  const filtered = publicIds.filter((id) => id && id.trim().length > 0);

  if (filtered.length === 0) {
    return;
  }

  await mediaQueue.add("cleanup", {
    publicIds: filtered,
  });
};
