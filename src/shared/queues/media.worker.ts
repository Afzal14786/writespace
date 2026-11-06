import { Worker, Job } from "bullmq";
import logger from "@config/logger";
import env from "@config/env";
import { bullmqRedisConnection } from "@config/bullmq";
import { MEDIA_QUEUE_NAME, type MediaCleanupJobData } from "./media.queue";
import { v2 as cloudinary } from "cloudinary";

// Cloudinary client
cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

export const mediaWorker = new Worker(
  MEDIA_QUEUE_NAME,
  async (job: Job<MediaCleanupJobData>) => {
    const { publicIds } = job.data;

    if (!Array.isArray(publicIds) || publicIds.length === 0) {
      logger.warn(`Media cleanup job ${job.id} received no publicIds`);
      return;
    }

    const failedPublicIds: string[] = [];

    for (const publicId of publicIds) {
      if (!publicId || publicId.startsWith("http")) {
        logger.warn(
          `Media cleanup skipped invalid public_id (looks like a URL): ${publicId}`,
        );
        continue;
      }

      try {
        await cloudinary.uploader.destroy(publicId);

        logger.info(`Cloudinary destroy succeeded for public_id: ${publicId}`);
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));

        failedPublicIds.push(publicId);

        logger.error(`Failed to delete Cloudinary asset ${publicId}`, err);

        // Do not throw here.
        // Continue processing the remaining publicIds so one
        // failed deletion does not block the entire batch.
      }
    }

    if (failedPublicIds.length > 0) {
      throw new Error(
        `Failed to delete ${failedPublicIds.length} Cloudinary asset(s): ${failedPublicIds.join(
          ", ",
        )}`,
      );
    }
  },
  {
    connection: bullmqRedisConnection,
    concurrency: env.MEDIA_WORKER_CONCURRENCY,
  },
);

mediaWorker.on("failed", (job: Job | undefined, err: Error) => {
  logger.error(`Media cleanup job ${job?.id} failed:`, err);
});

mediaWorker.on("error", (error) => {
  logger.error("Media worker error", { error });
});
