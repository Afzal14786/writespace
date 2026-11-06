import { Queue } from "bullmq";
import env from "@config/env";
import { bullmqRedisConnection } from "@config/bullmq";
import { NotificationType } from "@modules/notification/interface/notification.interface";

export interface IInteractionJob {
  type: NotificationType;
  recipientId: string;
  actorId?: string;
  relatedId?: string;
  message: string;
}

export const interactionQueue = new Queue<IInteractionJob>(
  "interaction-queue",
  {
    connection: bullmqRedisConnection,
  },
);

export const addInteractionJob = async (
  job: IInteractionJob,
): Promise<void> => {
  await interactionQueue.add("process-interaction", job, {
    attempts: env.INTERACTION_QUEUE_ATTEMPTS,
    backoff: {
      type: "fixed",
      delay: env.QUEUE_BACKOFF_DELAY_MS,
    },
    removeOnComplete: true,
    removeOnFail: false,
  });
};
