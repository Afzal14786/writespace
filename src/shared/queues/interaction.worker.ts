import { Worker } from "bullmq";
import env from "../../config/env";
import { NotificationModel } from "../../modules/notification/notification.model";
import { IInteractionJob } from "./interaction.queue";

// 1. Create the Worker instance
export const interactionWorker = new Worker<IInteractionJob>(
  "interaction-queue",
  async (job) => {
    const { recipientId, type, message, relatedId } = job.data;

    // Persist the notification to MongoDB
    // This runs in the background, keeping the main request loop fast
    await NotificationModel.create({
      recipient: recipientId,
      type,
      message,
      relatedId,
    });

    // Future enhancement: Here you could also trigger a WebSocket event
    // to push this notification to the user in real-time.
    // socket.to(recipientId).emit('notification', job.data);
  },
  {
    connection: {
      url: env.REDIS_URL,
      password: env.REDIS_PASSWORD,
    },
    concurrency: 10, // Higher concurrency for interactions as they are IO-bound and high volume
  },
);

interactionWorker.on("completed", (job) => {
  // console.debug(`Interaction job ${job.id} completed`);
});

interactionWorker.on("failed", (job, err) => {
  console.error(`Interaction job ${job?.id} failed: ${err.message}`);
});
