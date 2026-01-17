import { Worker } from "bullmq";
import { mailer } from "../infra/mailer";
import env from "../../config/env";
import { IEmailJob } from "../../modules/notification/interface/notification.interface";

// 1. Create the Worker instance
export const emailWorker = new Worker<IEmailJob>(
  "email-queue",
  async (job) => {
    console.log(`Processing email job ${job.id} for ${job.data.to}`);

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
  console.log(`Email job ${job.id} completed successfully`);
});

emailWorker.on("failed", (job, err) => {
  console.error(`Email job ${job?.id} failed with error: ${err.message}`);
});
