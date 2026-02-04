import { Worker } from "bullmq";
import { mailer } from "../infra/mailer";
import env from "../../config/env";
import { IEmailJob } from "../../modules/notification/interface/email.interface";
import logger from "../../config/logger";

// 1. Create the Worker instance
export const emailWorker = new Worker<IEmailJob>(
  "email-queue",
  async (job) => {
    // Check for stale OTP jobs (> 1 minute old)
    const now = Date.now();
    const jobAge = now - job.timestamp;

    if (job.data.subject.includes("OTP") && jobAge > 60000) {
      logger.warn(
        `Skipping stale OTP email job ${job.id} (Age: ${Math.round(jobAge / 1000)}s)`,
      );
      return;
    }

    logger.info(`Processing email job ${job.id} for ${job.data.to}`);

    await mailer.sendEmail({
      to: job.data.to,
      subject: job.data.subject,
      html: job.data.html,
    });
  },
  {
    connection: {
      url: env.REDIS_URL,
      password: env.REDIS_PASSWORD,
    },
    concurrency: 5, // Process 5 emails in parallel
  },
);

emailWorker.on("completed", (job) => {
  logger.info(`Email job ${job.id} completed successfully`);
});

emailWorker.on("failed", (job, err) => {
  logger.error(`Email job ${job?.id} failed with error: ${err.message}`);
});
