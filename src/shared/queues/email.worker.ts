import { Worker } from "bullmq";

import { mailer } from "../infra/mailer";
import env from "@config/env";
import { bullmqRedisConnection } from "@config/bullmq";

import type { IEmailPayload } from "@modules/notification/interface/email.interface";
import { EMAIL_QUEUE_NAME } from "./email.queue";

import logger from "@config/logger";

// Keep OTP email delivery aligned with the registration OTP expiration.
const OTP_EXPIRE_MS = 10 * 60 * 1000;

export const emailWorker = new Worker<IEmailPayload>(
  EMAIL_QUEUE_NAME,
  async (job) => {
    const now = Date.now();
    const jobAge = now - job.timestamp;

    /*
     * An OTP email must not be delivered after its corresponding
     * registration code has expired.
     */
    if (
      job.data.subject === "Verify Your Account - OTP" &&
      jobAge > OTP_EXPIRE_MS
    ) {
      logger.warn(
        `Skipping expired OTP email job ${job.id} (Age: ${Math.round(jobAge / 1000)}s)`,
      );
      return;
    }

    logger.info(`Processing email job ${job.id} for ${job.data.to}`);

    await mailer.sendEmail({
      to: job.data.to,
      subject: job.data.subject,
      html: job.data.html,
      text: job.data.text,
    });
  },
  {
    connection: bullmqRedisConnection,
    concurrency: env.EMAIL_WORKER_CONCURRENCY,
  },
);

emailWorker.on("completed", (job) => {
  logger.info(`Email job ${job.id} completed successfully`);
});

emailWorker.on("failed", (job, err) => {
  logger.error(`Email job ${job?.id} failed with error: ${err.message}`);
});

emailWorker.on("error", (error) => {
  logger.error("Email worker error", { error });
});
