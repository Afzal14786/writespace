import { Queue } from "bullmq";
import env from "../../config/env";
import { NotificationType } from "../../modules/notification/interface/notification.interface";

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
    connection: {
      url: env.REDIS_URL,
      password: env.REDIS_PASSWORD,
    },
  },
);

export const addInteractionJob = async (job: IInteractionJob): Promise<void> => {
  await interactionQueue.add("process-interaction", job, {
    attempts: 2,
    backoff: {
      type: "fixed",
      delay: 1000,
    },
    removeOnComplete: true, 
    removeOnFail: false,
  });
};