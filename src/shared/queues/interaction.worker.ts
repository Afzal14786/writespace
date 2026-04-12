import { Worker, type Job } from "bullmq";
import env from "@config/env";
import { db } from "../../db";
import { notifications, users } from "../../db/schema";
import { eq } from "drizzle-orm";
import { type IInteractionJob } from "./interaction.queue";
import logger from "@config/logger";

export const interactionWorker = new Worker<IInteractionJob>(
  "interaction-queue",
  async (job: Job<IInteractionJob>) => {
    const { recipientId, type, message, relatedId, actorId } = job.data;

    let finalMessage = message;

    if (actorId) {
      const [actor] = await db
        .select({ fullname: users.fullname, username: users.username })
        .from(users)
        .where(eq(users.id, actorId))
        .limit(1);

      if (actor) {
        const displayName = actor.fullname || actor.username;
        finalMessage = `${displayName} ${message}`; 
      }
    }

    await db.insert(notifications).values({
      recipientId,
      actorId: actorId || null,      // MUST BE ADDED
      type,
      message: finalMessage,
      relatedId: relatedId || null,  // MUST FALLBACK TO NULL
    });
  },
  {
    connection: {
      url: env.REDIS_URL,
      password: env.REDIS_PASSWORD,
    },
    concurrency: 10,
  },
);

interactionWorker.on("failed", (job: Job<IInteractionJob> | undefined, err: Error) => {
  logger.error(`Interaction job ${job?.id} failed: ${err.message}`);
});