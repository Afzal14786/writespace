import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

import env from "@config/env";
import logger from "@config/logger";

import { notificationReconciliationService } from "../services/notification-reconciliation.service";

/**
 * A unique identity for this reconciliation process.
 *
 * Multiple application instances may run reconciliation simultaneously.
 * PostgreSQL reconciliation leases coordinate ownership between them.
 */
const workerId = `${hostname()}:${process.pid}:${randomUUID()}`;

/**
 * Periodically reconciles PostgreSQL notification delivery records
 * against their corresponding BullMQ jobs.
 *
 * This is a scheduled service worker, not a BullMQ consumer.
 *
 * It stops scheduling new cycles during shutdown and waits for any
 * active reconciliation cycle to finish before releasing resources.
 */
class NotificationReconciliationWorker {
  private timer: ReturnType<typeof setTimeout> | null = null;

  private activeCycle: Promise<void> | null = null;

  private started = false;

  private stopping = false;

  /**
   * Start reconciliation immediately, then schedule subsequent cycles.
   */
  public start(): void {
    if (this.started || this.stopping) {
      return;
    }

    this.started = true;

    logger.info("Notification reconciliation worker started", {
      workerId,
      intervalMs: env.NOTIFICATION_RECONCILIATION_INTERVAL_MS,
    });

    void this.runCycle();
  }

  /**
   * Execute one cycle and schedule the next only after completion.
   *
   * Keeping a single active cycle prevents overlapping database
   * reconciliation batches within this process.
   */
  private async runCycle(): Promise<void> {
    if (this.stopping || this.activeCycle) {
      return;
    }

    this.activeCycle = this.executeCycle();

    try {
      await this.activeCycle;
    } finally {
      this.activeCycle = null;

      if (!this.stopping) {
        this.scheduleNextCycle();
      }
    }
  }

  /**
   * Execute one bounded reconciliation cycle.
   */
  private async executeCycle(): Promise<void> {
    try {
      await notificationReconciliationService.reconcile({
        workerId,
        batchSize: env.NOTIFICATION_RECONCILIATION_BATCH_SIZE,
        leaseDurationMs: env.NOTIFICATION_RECONCILIATION_LEASE_DURATION_MS,
        initialGracePeriodMs:
          env.NOTIFICATION_RECONCILIATION_INITIAL_GRACE_PERIOD_MS,
        maxAttempts: env.NOTIFICATION_RECONCILIATION_MAX_ATTEMPTS,
        retryDelayMs: env.NOTIFICATION_RECONCILIATION_RETRY_DELAY_MS,
      });
    } catch (error) {
      /*
       * A failed cycle must not terminate the reconciliation worker.
       * The next scheduled cycle will retry the database inspection.
       */
      logger.error("Notification reconciliation cycle failed", {
        workerId,
        error,
      });
    }
  }

  /**
   * Schedule another cycle after the configured polling interval.
   */
  private scheduleNextCycle(): void {
    if (this.stopping) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runCycle();
    }, env.NOTIFICATION_RECONCILIATION_INTERVAL_MS);

    // Do not prevent Node.js from exiting solely because of this timer.
    this.timer.unref();
  }

  /**
   * Stop scheduling reconciliation and wait for an active cycle.
   *
   * This allows the server to close BullMQ queues and PostgreSQL
   * only after reconciliation has stopped using them.
   */
  public async close(): Promise<void> {
    if (this.stopping) {
      return;
    }

    this.stopping = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.activeCycle) {
      await this.activeCycle;
    }

    logger.info("Notification reconciliation worker stopped", {
      workerId,
    });
  }
}

export const notificationReconciliationWorker =
  new NotificationReconciliationWorker();
