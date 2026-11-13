import env from "@config/env";
import logger from "@config/logger";

import { outboxDispatcherService } from "../services/outbox-dispatcher.service";

/**
 * Configuration for the outbox dispatcher.
 *
 * The values are validated by env.ts before the application starts.
 */
const dispatcherOptions = {
  batchSize: env.OUTBOX_DISPATCHER_BATCH_SIZE,
  leaseDurationMs: env.OUTBOX_DISPATCHER_LEASE_DURATION_MS,
  maxAttempts: env.OUTBOX_DISPATCHER_MAX_ATTEMPTS,
  backoffBaseMs: env.OUTBOX_DISPATCHER_BACKOFF_BASE_MS,
  backoffMaxMs: env.OUTBOX_DISPATCHER_BACKOFF_MAX_MS,
};

/**
 * Polls PostgreSQL for dispatchable outbox events.
 *
 * Lifecycle:
 * - start() begins an immediate dispatch cycle.
 * - A new cycle starts only after the previous one has completed.
 * - close() stops future cycles and waits for any active batch to finish.
 *
 * The server must stop this dispatcher before closing the notification
 * event consumer, otherwise the dispatcher could enqueue jobs while the
 * consumer is already shutting down.
 */
export class OutboxDispatcherWorker {
  private isRunning = false;

  private loopPromise: Promise<void> | undefined;

  private pollTimer: ReturnType<typeof setTimeout> | undefined;

  private resolvePendingPoll: (() => void) | undefined;

  /**
   * Start polling.
   *
   * This method is intentionally idempotent; calling start() more than
   * once will not create multiple polling loops.
   */
  public start(): void {
    if (this.isRunning) {
      logger.warn("Outbox dispatcher is already running");
      return;
    }

    this.isRunning = true;

    logger.info("Outbox dispatcher started", {
      pollIntervalMs: env.OUTBOX_DISPATCHER_POLL_INTERVAL_MS,
      batchSize: dispatcherOptions.batchSize,
      leaseDurationMs: dispatcherOptions.leaseDurationMs,
    });

    this.loopPromise = this.runLoop().catch((error: unknown) => {
      // runLoop handles normal batch failures internally. This catch is a
      // final guard against an unexpected lifecycle/polling failure.
      this.isRunning = false;

      logger.error("Outbox dispatcher loop stopped unexpectedly", {
        error,
      });
    });
  }

  /**
   * Stop polling and wait for the current dispatch batch to finish.
   *
   * No new batch will start after this method is called.
   */
  public async close(): Promise<void> {
    if (!this.isRunning && !this.loopPromise) {
      return;
    }

    this.isRunning = false;

    // Wake a loop that is currently waiting for its next polling interval.
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }

    const resolvePendingPoll = this.resolvePendingPoll;
    this.resolvePendingPoll = undefined;
    resolvePendingPoll?.();

    // If a dispatch batch is currently running, wait for it to finish.
    await this.loopPromise;

    this.loopPromise = undefined;

    logger.info("Outbox dispatcher stopped");
  }

  /**
   * Execute dispatch cycles sequentially.
   *
   * A temporary database/Redis failure is logged here. The next cycle
   * will retry, while individual event handoff failures are handled by
   * OutboxDispatcherService and persisted in the outbox.
   */
  private async runLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await outboxDispatcherService.dispatchBatch(dispatcherOptions);
      } catch (error) {
        logger.error("Outbox dispatcher batch failed", {
          error,
        });
      }

      if (!this.isRunning) {
        break;
      }

      await this.waitForNextPoll();
    }
  }

  /**
   * Wait for the configured polling interval.
   *
   * Keeping the timer reference lets close() wake the loop immediately
   * rather than waiting for the full polling interval during shutdown.
   */
  private waitForNextPoll(): Promise<void> {
    return new Promise((resolve) => {
      this.resolvePendingPoll = resolve;

      this.pollTimer = setTimeout(() => {
        this.pollTimer = undefined;
        this.resolvePendingPoll = undefined;
        resolve();
      }, env.OUTBOX_DISPATCHER_POLL_INTERVAL_MS);
    });
  }
}

export const outboxDispatcherWorker = new OutboxDispatcherWorker();
