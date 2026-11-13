import { createServer, type Server } from "node:http";

import env from "./config/env";
import { client as redisClient, connectRedis } from "./config/redis";
import { initializeNotificationSocketServer } from "./modules/notification/realtime/notification-socket.server";
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
  let notificationSocketServer:
    | ReturnType<typeof initializeNotificationSocketServer>
    | undefined;
  let isShuttingDown = false;

  // Close application resources gracefully.
  async function gracefulShutdown(reason: string, exitCode = 0): Promise<void> {
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

    /*
     * Socket.IO owns the attached HTTP server's shutdown.
     *
     * Closing Socket.IO first disconnects connected clients and closes
     * the underlying HTTP server. Do not call server.close() separately.
     */
    if (notificationSocketServer) {
      const activeSocketServer = notificationSocketServer;

      await closeResource(
        "Notification Socket.IO and HTTP server",
        () =>
          new Promise<void>((resolve) => {
            activeSocketServer.close(() => resolve());
          }),
      );
    } else if (server?.listening) {
      // Fallback for startup failures before Socket.IO initialization.
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

    /*
     * Stop the dispatcher before the consumers.
     *
     * This prevents new queue jobs from being published while the
     * notification workers are shutting down.
     */
    for (const worker of workers) {
      await closeResource(worker.name, worker.close);
    }

    // Close queues after their workers have drained.
    for (const queue of queues) {
      await closeResource(queue.name, queue.close);
    }

    if (redisClient.isOpen) {
      await closeResource("Redis connection", () => redisClient.quit());
    }

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

    // Initialize existing queue instances after Redis is connected.
    const { emailQueue } = await import("./shared/queues/email.queue");

    queues.push({
      name: "Email queue",
      close: () => emailQueue.close(),
    });

    const { mediaQueue } = await import("./shared/queues/media.queue");

    queues.push({
      name: "Media queue",
      close: () => mediaQueue.close(),
    });

    // Load the Express application after infrastructure initialization.
    const { default: app } = await import("./app");

    // Create one HTTP server shared by Express and Socket.IO.
    server = createServer(app);

    // Attach the authenticated notification socket server.
    notificationSocketServer = initializeNotificationSocketServer(server);

    // Initialize existing background workers.
    const { emailWorker } = await import("./shared/queues/email.worker");

    workers.push({
      name: "Email worker",
      close: () => emailWorker.close(),
    });

    const { mediaWorker } = await import("./shared/queues/media.worker");

    workers.push({
      name: "Media worker",
      close: () => mediaWorker.close(),
    });

    /**
     * Initialize durable notification queues and workers only when
     * explicitly enabled.
     *
     * Interaction services use the same flag before recording notification
     * domain events. Existing pending outbox rows remain durable and can
     * be processed when the pipeline is enabled again.
     */
    if (env.OUTBOX_PROCESSING_ENABLED) {
      const { notificationEventsQueue } =
        await import("./shared/queues/notification-events.queue");

      queues.push({
        name: "Notification events queue",
        close: () => notificationEventsQueue.close(),
      });

      const { notificationDeliveryEventsQueue } =
        await import("./shared/queues/notification-delivery-events.queue");

      queues.push({
        name: "Notification delivery events queue",
        close: () => notificationDeliveryEventsQueue.close(),
      });

      // Start the domain event consumer.
      const { notificationEventsWorker } =
        await import("./modules/notification/workers/notification-events.worker");

      workers.push({
        name: "Notification events worker",
        close: () => notificationEventsWorker.close(),
      });

      await notificationEventsWorker.waitUntilReady();

      // Start the channel delivery consumer.
      const { notificationDeliveryEventsWorker } =
        await import("./modules/notification/workers/notification-delivery-events.worker");

      workers.push({
        name: "Notification delivery events worker",
        close: () => notificationDeliveryEventsWorker.close(),
      });

      await notificationDeliveryEventsWorker.waitUntilReady();

      /*
       * Start delivery reconciliation only after the delivery queue
       * and its consumer are ready.
       */
      const { notificationReconciliationWorker } =
        await import("./modules/notification/workers/notification-reconciliation.worker");

      /*
       * Stop reconciliation before its queue consumers during shutdown.
       *
       * The outbox dispatcher is added with unshift() below, so it
       * will stop first, followed by reconciliation and then consumers.
       */
      workers.unshift({
        name: "Notification reconciliation worker",
        close: () => notificationReconciliationWorker.close(),
      });

      notificationReconciliationWorker.start();

      /*
       * Start the dispatcher only after both consumers are ready.
       *
       * It is unshifted so it is stopped first during graceful shutdown.
       */
      const { outboxDispatcherWorker } =
        await import("./modules/notification/workers/outbox-dispatcher.worker");

      workers.unshift({
        name: "Outbox dispatcher",
        close: () => outboxDispatcherWorker.close(),
      });

      outboxDispatcherWorker.start();

      logger.info("Durable notification event and delivery pipelines enabled");
    } else {
      logger.warn(
        "Durable notification event processing is disabled. " +
          "New events will remain pending in PostgreSQL until the dispatcher is enabled.",
      );
    }

    // Start the HTTP server.
    server.listen(env.PORT, "0.0.0.0", () => {
      logger.info(`Server is running on port ${env.PORT}`);
    });

    server.on("error", (error) => {
      logger.error("HTTP server error", { error });
      void gracefulShutdown("HTTP server error", 1);
    });

    process.on("SIGTERM", () => {
      void gracefulShutdown("SIGTERM");
    });

    process.on("SIGINT", () => {
      void gracefulShutdown("SIGINT");
    });

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
