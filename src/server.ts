import type { Server } from "node:http";
import env from "./config/env";
import { client as redisClient, connectRedis } from "./config/redis";
import { pool } from "./db";
import logger from "./config/logger";

interface CloseableResource {
  name: string;
  close: () => Promise<unknown>;
}

async function startServer(): Promise<void> {
  const workers: CloseableResource[] = [];
  const queues: CloseableResource[] = [];

  let server: Server | undefined;
  let isShuttingDown = false;

  // Close application resources gracefully.
  async function gracefulShutdown(
    reason: string,
    exitCode = 0,
  ): Promise<void> {
    if (isShuttingDown) {
      logger.warn(`Shutdown already in progress, ignoring "${reason}"`);
      return;
    }

    isShuttingDown = true;

    logger.info(`${reason} received. Starting graceful shutdown...`);

    let shutdownFailed = false;

    const forceExit = setTimeout(() => {
      logger.error("Graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS);

    forceExit.unref();

    async function closeResource(
      name: string,
      close: () => Promise<unknown>,
    ): Promise<void> {
      try {
        await close();
        logger.info(`${name} closed`);
      } catch (error) {
        shutdownFailed = true;
        logger.error(`Error closing ${name.toLowerCase()}`, { error });
      }
    }

    // Stop accepting new HTTP requests.
    if (server?.listening) {
      await new Promise<void>((resolve) => {
        server!.close((error) => {
          if (error) {
            shutdownFailed = true;
            logger.error("Error closing HTTP server", { error });
          } else {
            logger.info("HTTP server closed");
          }

          resolve();
        });
      });
    }

    // Close workers before their associated queues.
    for (const worker of workers) {
      await closeResource(worker.name, worker.close);
    }

    // Close queue connections.
    for (const queue of queues) {
      await closeResource(queue.name, queue.close);
    }

    // Close Redis.
    if (redisClient.isOpen) {
      await closeResource("Redis connection", () => redisClient.quit());
    }

    // Close PostgreSQL.
    await closeResource("PostgreSQL pool", () => pool.end());

    clearTimeout(forceExit);

    logger.info("Graceful shutdown complete");

    process.exit(shutdownFailed ? 1 : exitCode);
  }

  try {
    logger.info("Starting WriteSpace server...");

    // Verify PostgreSQL connectivity.
    await pool.query("SELECT 1");
    logger.info("PostgreSQL connected successfully");

    // Establish Redis connection.
    await connectRedis();
    logger.info("Redis connected successfully");

    // Initialize queue instances after Redis is connected.
    const { emailQueue } = await import("./shared/queues/email.queue");
    queues.push({
      name: "Email queue",
      close: () => emailQueue.close(),
    });

    const { notificationQueue } = await import(
      "./shared/queues/notification.queue"
    );
    queues.push({
      name: "Notification queue",
      close: () => notificationQueue.close(),
    });

    const { mediaQueue } = await import("./shared/queues/media.queue");
    queues.push({
      name: "Media queue",
      close: () => mediaQueue.close(),
    });

    // Load the Express application after infrastructure initialization.
    const { default: app } = await import("./app");

    // Initialize background workers.
    const { emailWorker } = await import("./shared/queues/email.worker");
    workers.push({
      name: "Email worker",
      close: () => emailWorker.close(),
    });

    const { notificationWorker } = await import(
      "./shared/queues/notification.worker"
    );
    workers.push({
      name: "Notification worker",
      close: () => notificationWorker.close(),
    });

    const { mediaWorker } = await import("./shared/queues/media.worker");
    workers.push({
      name: "Media worker",
      close: () => mediaWorker.close(),
    });

    // Start the HTTP server.
    server = app.listen(env.PORT, "0.0.0.0", () => {
      logger.info(`Server is running on port ${env.PORT}`);
    });

    server.on("error", (error) => {
      logger.error("HTTP server error", { error });
      void gracefulShutdown("HTTP server error", 1);
    });

    // Handle process termination signals.
    process.on("SIGTERM", () => {
      void gracefulShutdown("SIGTERM");
    });

    process.on("SIGINT", () => {
      void gracefulShutdown("SIGINT");
    });

    // Handle unexpected application errors.
    process.on("uncaughtException", (error) => {
      logger.error("Uncaught exception", { error });
      void gracefulShutdown("Uncaught exception", 1);
    });

    process.on("unhandledRejection", (reason) => {
      const error =
        reason instanceof Error ? reason : new Error(String(reason));

      logger.error("Unhandled rejection", { error });
      void gracefulShutdown("Unhandled rejection", 1);
    });
  } catch (error) {
    logger.error("Failed to start WriteSpace", { error });
    await gracefulShutdown("Startup failure", 1);
  }
}

void startServer();
