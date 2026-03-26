import { Worker, Job } from "bullmq";
import fs from "fs/promises";
import path from "path";
import logger from "../../config/logger";
import env from "../../config/env";

// Parse the REDIS_URL from env.ts to extract host and port for BullMQ
const redisUrl = new URL(env.REDIS_URL);
const redisConnectionOptions = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || "6379", 10),
  password: env.REDIS_PASSWORD || redisUrl.password || undefined,
};

export const mediaWorker = new Worker(
  "media-cleanup",
  async (job: Job) => {
    // Explicit, safe typing
    const { fileUrls } = job.data as { fileUrls: string[] };

    for (const fileUrl of fileUrls) {
      try {
        if (fileUrl.startsWith("/uploads/")) {
          const absolutePath = path.join(process.cwd(), fileUrl);
          await fs.unlink(absolutePath);
          logger.info(`Successfully deleted orphaned media: ${fileUrl}`);
        }
      } catch (error: unknown) {
        // 100% Type-Safe Node error casting
        const err = error as NodeJS.ErrnoException;
        if (err.code !== 'ENOENT') { 
          logger.error(`Failed to delete media ${fileUrl}:`, err);
        }
      }
    }
  },
  { connection: redisConnectionOptions }
);

// Type-safe error listener
mediaWorker.on("failed", (job: Job | undefined, err: Error) => {
  logger.error(`Media cleanup job ${job?.id} failed:`, err);
});