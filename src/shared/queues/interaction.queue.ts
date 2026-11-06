import { Queue } from "bullmq";

import env from "@config/env";
import { bullmqRedisConnection } from "@config/bullmq";

export const INTERACTION_QUEUE_NAME = "interaction";

export interface InteractionEventJob {
  eventId: number;
}

export const interactionQueue = new Queue<InteractionEventJob>(
  INTERACTION_QUEUE_NAME,
  {
    connection: bullmqRedisConnection,

    defaultJobOptions: {
      attempts: env.INTERACTION_QUEUE_ATTEMPTS,

      backoff: {
        type: "exponential",
        delay: env.QUEUE_BACKOFF_DELAY_MS,
      },

      removeOnComplete: true,
      removeOnFail: false,
    },
  },
);

export const addInteractionEventJob = async (
  eventId: number,
): Promise<void> => {
  await interactionQueue.add("process-interaction-event", {
    eventId,
  });
};
