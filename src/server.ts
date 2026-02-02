import app from "./app";
import { emailWorker } from "./shared/queues/email.worker";
import { interactionWorker } from "./shared/queues/interaction.worker";
import { client as redisClient } from "./config/redis";
import { pool } from "./db";
import logger from "./config/logger";

const PORT = process.env.PORT;

const server = app
  .listen(PORT, () => {
    logger.info(`Server is running on port no ${PORT}`);
  })
  .on("error", (err) => {
    logger.error(`Error while running the server : ${err}`);
    process.exit(1);
  });

async function gracefulShutdown(signal: string) {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  server.close(() => {
    logger.info("HTTP server closed");
  });

  try {
    await emailWorker.close();
    logger.info("Email worker closed");
  } catch (err) {
    logger.error(`Error closing email worker: ${err}`);
  }

  try {
    await interactionWorker.close();
    logger.info("Interaction worker closed");
  } catch (err) {
    logger.error(`Error closing interaction worker: ${err}`);
  }

  try {
    await redisClient.quit();
    logger.info("Redis connection closed");
  } catch (err) {
    logger.error(`Error closing Redis: ${err}`);
  }

  try {
    await pool.end();
    logger.info("PostgreSQL pool closed");
  } catch (err) {
    logger.error(`Error closing PostgreSQL pool: ${err}`);
  }

  logger.info("Graceful shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
