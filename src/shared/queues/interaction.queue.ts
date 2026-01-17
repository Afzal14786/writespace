import { Queue } from "bullmq";
import env from "../../config/env";
import { NotificationType } from "../../modules/notification/interface/notification.interface";

// Payload for interaction jobs
export interface IInteractionJob {
  type: NotificationType;
  recipientId: string;
  actorId?: string; // Who performed the action
  relatedId?: string; // Post ID, Comment ID, etc.
  message: string;
}

// 1. Create the Queue instance
export const interactionQueue = new Queue<IInteractionJob>(
  "interaction-queue",
  {
    connection: {
      url: env.REDIS_URL,
      password: env.REDIS_PASSWORD,
    },
  },
);

/**
 * Adds an interaction job to the queue.
 * These are high-volume events (likes, comments) handled asynchronously.
 */
export const addInteractionJob = async (job: IInteractionJob) => {
  // Fire and forget strategy (no removeOnComplete to keep history optional, but usually keep clean)
  await interactionQueue.add("process-interaction", job, {
    attempts: 2,
    backoff: {
      type: "fixed",
      delay: 1000,
    },
    removeOnComplete: true, // Auto-remove successful jobs
    removeOnFail: false,
  });
};
