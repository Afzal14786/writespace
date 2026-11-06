import { Worker } from "bullmq";

import env from "@config/env";
import { bullmqRedisConnection } from "@config/bullmq";
import logger from "@config/logger";

import {
  INTERACTION_QUEUE_NAME,
  type InteractionEventJob,
} from "../queues/interaction.queue";

import { interactionEventRepository } from "../repositories/interaction-event.repository";

export const interactionWorker = new Worker<InteractionEventJob>(
  INTERACTION_QUEUE_NAME,
  async (job) => {
    const { eventId } = job.data;

    if (!Number.isInteger(eventId) || eventId <= 0) {
      throw new Error(`Invalid interaction event id: ${eventId}`);
    }

    const event = await interactionEventRepository.getEventById(eventId);

    if (!event) {
      throw new Error(`Interaction event not found: ${eventId}`);
    }

    logger.info("Processing interaction event", {
      jobId: job.id,
      eventId: event.id,
      eventType: event.eventType,
      targetType: event.targetType,
      targetId: event.targetId,
      actorId: event.actorId,
    });

    return;
  },
  {
    connection: bullmqRedisConnection,
    concurrency: env.INTERACTION_WORKER_CONCURRENCY,
  },
);

interactionWorker.on("completed", (job) => {
  logger.info("Interaction job completed", {
    jobId: job.id,
  });
});

interactionWorker.on("failed", (job, error) => {
  logger.error("Interaction job failed", {
    jobId: job?.id,
    error,
  });
});

interactionWorker.on("error", (error) => {
  logger.error("Interaction worker error", {
    error,
  });
});
