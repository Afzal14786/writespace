import { Queue } from "bullmq";
import env from "@config/env";
import { bullmqRedisConnection } from "@config/bullmq";
import type { IEmailPayload } from "@modules/notification/interface/email.interface";

export const EMAIL_QUEUE_NAME = "email-queue";

export const emailQueue = new Queue<IEmailPayload>(EMAIL_QUEUE_NAME, {
  connection: bullmqRedisConnection,
  defaultJobOptions: {
    attempts: env.EMAIL_QUEUE_ATTEMPTS,
    backoff: {
      type: "exponential",
      delay: env.QUEUE_BACKOFF_DELAY_MS,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

export const addEmailJob = async (job: IEmailPayload): Promise<void> => {
  await emailQueue.add("send-email", job);
};
