import { Queue } from "bullmq";
import env from "../../config/env";
import { IEmailJob } from "../../modules/notification/interface/notification.interface";

// 1. Create the Queue instance
// Note: connection options are passed from the shared redis config or directly here
export const emailQueue = new Queue<IEmailJob>("email-queue", {
  connection: {
    url: env.REDIS_URL,
    password: env.REDIS_PASSWORD,
  },
});

/**
 * Adds an email job to the queue.
 * @param job {IEmailJob} - The email payload.
 */
export const addEmailJob = async (job: IEmailJob) => {
  // Retry strategy: 3 attempts with exponential backoff
  await emailQueue.add("send-email", job, {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: true, // Keep Redis clean
    removeOnFail: false, // Keep failed jobs for debugging
  });
};
