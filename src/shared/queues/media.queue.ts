import { Queue } from "bullmq";
import env from "../../config/env";

// Parse the REDIS_URL from env.ts to extract host and port for BullMQ
const redisUrl = new URL(env.REDIS_URL);
const redisConnectionOptions = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || "6379", 10),
  password: env.REDIS_PASSWORD || redisUrl.password || undefined,
};

export const mediaQueue = new Queue("media-cleanup", { 
  connection: redisConnectionOptions 
});

export const addMediaCleanupJob = async (fileUrls: string[]): Promise<void> => {
  if (fileUrls.length === 0) return;
  
  await mediaQueue.add("cleanup", { fileUrls }, { 
    removeOnComplete: true,
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 }
  });
};