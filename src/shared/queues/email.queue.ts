import { Queue, type JobsOptions } from "bullmq";

import env from "@config/env";
import { bullmqRedisConnection } from "@config/bullmq";

import type { IEmailPayload } from "@modules/notification/interface/email.interface";

export const EMAIL_QUEUE_NAME = "email-queue";

/*
 * Retain ordinary failed email jobs for a limited period so operational
 * failures can still be inspected without keeping sensitive payloads
 * in Redis indefinitely.
 *
 * BullMQ performs age-based cleanup lazily when subsequent jobs fail.
 */
const FAILED_EMAIL_JOB_RETENTION = {
  age: 24 * 60 * 60,
  count: 5000,
};

export const emailQueue = new Queue<IEmailPayload>(EMAIL_QUEUE_NAME, {
  connection: bullmqRedisConnection,
  defaultJobOptions: {
    attempts: env.EMAIL_QUEUE_ATTEMPTS,

    backoff: {
      type: "exponential",
      delay: env.QUEUE_BACKOFF_DELAY_MS,
    },

    // Successfully processed emails do not need to remain in Redis.
    removeOnComplete: true,

    // Bound failed-job retention instead of retaining failed payloads forever.
    removeOnFail: FAILED_EMAIL_JOB_RETENTION,
  },
});

/**
 * Enqueue a transactional email.
 *
 * Job-specific options allow sensitive email types, such as OTP and
 * password-reset messages, to override the default failed-job retention.
 */
export const addEmailJob = async (
  job: IEmailPayload,
  options?: JobsOptions,
): Promise<void> => {
  await emailQueue.add("send-email", job, options);
};
