import logger from "@config/logger";

import { notificationDeliveryEventsQueue } from "@shared/queues/notification-delivery-events.queue";

import {
  notificationReconciliationRepository,
  type ClaimedNotificationReconciliation,
} from "../repositories/notification-reconciliation.repository";

import type { ClaimNotificationReconciliationInput } from "../repositories/notification-reconciliation.repository";

const DELIVERY_JOB_NAME = "process-notification-delivery-event";

/**
 * Configuration required to run one reconciliation cycle.
 */
export interface NotificationReconciliationOptions extends ClaimNotificationReconciliationInput {
  retryDelayMs: number;
}

export interface NotificationReconciliationResult {
  expiredLeasesResolved: number;
  expiredDeliveries: number;
  failedOutboxEventsFlagged: number;
  inspected: number;
  jobsRecreated: number;
  failedJobsRetried: number;
  completedJobsRequeued: number;
  healthyJobs: number;
  errors: number;
}

/**
 * Reconciles PostgreSQL delivery records with their BullMQ jobs.
 *
 * PostgreSQL remains the source of truth for delivery state.
 * BullMQ is only the execution mechanism.
 *
 * This service never creates a new logical delivery or outbox event.
 */
export class NotificationReconciliationService {
  /**
   * Run one bounded reconciliation cycle.
   *
   * First resolve expired delivery leases and expired delivery requests.
   * Then flag failed outbox handoffs for manual recovery and inspect due
   * deliveries whose outbox events were already published.
   */
  public async reconcile(
    options: NotificationReconciliationOptions,
  ): Promise<NotificationReconciliationResult> {
    if (
      !Number.isSafeInteger(options.retryDelayMs) ||
      options.retryDelayMs < 1
    ) {
      throw new Error(
        "Notification reconciliation retry delay must be positive.",
      );
    }

    const result: NotificationReconciliationResult = {
      expiredLeasesResolved: 0,
      expiredDeliveries: 0,
      failedOutboxEventsFlagged: 0,
      inspected: 0,
      jobsRecreated: 0,
      failedJobsRetried: 0,
      completedJobsRequeued: 0,
      healthyJobs: 0,
      errors: 0,
    };

    result.expiredLeasesResolved =
      await notificationReconciliationRepository.resolveExpiredProcessingLeases(
        options.batchSize,
      );

    result.expiredDeliveries =
      await notificationReconciliationRepository.expireDueDeliveries(
        options.batchSize,
      );

    /*
     * A FAILED outbox event is not automatically republished here.
     * The dispatcher owns outbox delivery, and exhausted events require
     * explicit operational recovery.
     *
     * We flag the related delivery so that the problem is visible.
     */
    const failedOutboxDeliveries =
      await notificationReconciliationRepository.flagFailedOutboxDeliveries(
        options.batchSize,
      );

    result.failedOutboxEventsFlagged = failedOutboxDeliveries.length;

    for (const failedDelivery of failedOutboxDeliveries) {
      logger.error(
        "Notification delivery requires manual outbox recovery",
        failedDelivery,
      );
    }

    const claims =
      await notificationReconciliationRepository.claimDueDeliveries(options);

    result.inspected = claims.length;

    for (const claim of claims) {
      await this.reconcileOne(claim, options, result);
    }

    if (
      result.expiredLeasesResolved > 0 ||
      result.expiredDeliveries > 0 ||
      result.failedOutboxEventsFlagged > 0 ||
      result.jobsRecreated > 0 ||
      result.failedJobsRetried > 0 ||
      result.completedJobsRequeued > 0 ||
      result.errors > 0
    ) {
      logger.info("Notification reconciliation cycle completed", result);
    }

    return result;
  }

  /**
   * Consume one durable recovery attempt before changing BullMQ state.
   *
   * The counter is recorded first so a process crash after a queue
   * mutation cannot silently reset the recovery budget.
   */
  private async beginRecoveryAttempt(
    claim: ClaimedNotificationReconciliation,
    options: NotificationReconciliationOptions,
  ): Promise<number> {
    const attemptCount =
      await notificationReconciliationRepository.markRecoveryAttempt({
        deliveryId: claim.delivery.id,
        workerId: options.workerId,
        maxAttempts: options.maxAttempts,
      });

    if (attemptCount === null) {
      throw new Error(
        "Reconciliation ownership was lost or its recovery budget was exhausted.",
      );
    }

    return attemptCount;
  }

  /**
   * Inspect and, when safe, recover one delivery's queue job.
   */
  private async reconcileOne(
    claim: ClaimedNotificationReconciliation,
    options: NotificationReconciliationOptions,
    result: NotificationReconciliationResult,
  ): Promise<void> {
    const { delivery, outboxEvent } = claim;

    const jobId = `notification-delivery-event-${outboxEvent.id}`;

    let recoveryAttempted = false;
    let recoveryBudgetExhausted = false;
    let errorCode: string | null = null;

    try {
      const job = await notificationDeliveryEventsQueue.getJob(jobId);

      /*
       * A missing queue job can be recreated because the corresponding
       * PostgreSQL outbox event is already PUBLISHED and its delivery
       * record is still eligible for another attempt.
       */
      if (!job) {
        const attemptCount = await this.beginRecoveryAttempt(claim, options);

        recoveryAttempted = true;
        recoveryBudgetExhausted = attemptCount >= options.maxAttempts;

        await notificationDeliveryEventsQueue.add(
          DELIVERY_JOB_NAME,
          {
            eventId: outboxEvent.id,
          },
          {
            jobId,
          },
        );

        result.jobsRecreated++;

        errorCode = "delivery_queue_job_recreated";

        logger.warn("Missing notification delivery job recreated", {
          deliveryId: delivery.id,
          eventId: outboxEvent.id,
          jobId,
        });
      } else if (job.data?.eventId !== outboxEvent.id) {
        /*
         * Never manipulate a job whose payload references a different
         * outbox event, even if its deterministic job ID looks correct.
         *
         * Consume a bounded diagnostic attempt so this inconsistency
         * does not produce an endless stream of repeated warnings.
         */
        const attemptCount = await this.beginRecoveryAttempt(claim, options);

        recoveryAttempted = true;
        recoveryBudgetExhausted = attemptCount >= options.maxAttempts;
        errorCode = "delivery_queue_job_event_id_mismatch";
        result.errors++;

        logger.error(
          "Notification delivery job payload does not match its outbox event",
          {
            deliveryId: delivery.id,
            eventId: outboxEvent.id,
            jobId,
            jobEventId: job.data?.eventId,
          },
        );
      } else {
        const state = await job.getState();

        switch (state) {
          case "failed": {
            /*
             * BullMQ exhausted its regular attempts.
             *
             * Retry the retained job using the same job ID. PostgreSQL
             * owns the separate, bounded reconciliation recovery budget.
             */
            const attemptCount = await this.beginRecoveryAttempt(
              claim,
              options,
            );

            recoveryAttempted = true;
            recoveryBudgetExhausted = attemptCount >= options.maxAttempts;

            await job.retry("failed", {
              resetAttemptsMade: true,
              resetAttemptsStarted: true,
            });

            result.failedJobsRetried++;

            errorCode = "delivery_failed_job_retried";

            logger.warn("Failed notification delivery job retried", {
              deliveryId: delivery.id,
              eventId: outboxEvent.id,
              jobId,
            });

            break;
          }

          case "completed": {
            /*
             * BullMQ considers the job complete, but PostgreSQL still
             * says the delivery is queued or retryable_failed.
             *
             * Remove the retained completed job before recreating it.
             */
            const attemptCount = await this.beginRecoveryAttempt(
              claim,
              options,
            );

            recoveryAttempted = true;
            recoveryBudgetExhausted = attemptCount >= options.maxAttempts;

            await job.remove();

            await notificationDeliveryEventsQueue.add(
              DELIVERY_JOB_NAME,
              {
                eventId: outboxEvent.id,
              },
              {
                jobId,
              },
            );

            result.completedJobsRequeued++;

            errorCode = "delivery_completed_job_requeued";

            logger.warn("Inconsistent completed notification job requeued", {
              deliveryId: delivery.id,
              eventId: outboxEvent.id,
              jobId,
            });

            break;
          }

          case "active":
          case "waiting":
          case "delayed":
          case "prioritized":
          case "waiting-children": {
            // The queue already contains work that can be processed.
            result.healthyJobs++;
            break;
          }

          case "unknown": {
            /*
             * Do not mutate a job whose state cannot be established.
             * Consume a bounded diagnostic attempt and retain the reason.
             */
            const attemptCount = await this.beginRecoveryAttempt(
              claim,
              options,
            );

            recoveryAttempted = true;
            recoveryBudgetExhausted = attemptCount >= options.maxAttempts;
            errorCode = "delivery_queue_job_state_unknown";
            result.errors++;

            logger.error(
              "Notification delivery job has an unknown BullMQ state",
              {
                deliveryId: delivery.id,
                eventId: outboxEvent.id,
                jobId,
              },
            );

            break;
          }

          default: {
            /*
             * Unknown future BullMQ states must not be treated as
             * permission to recreate or retry a job.
             */
            const attemptCount = await this.beginRecoveryAttempt(
              claim,
              options,
            );

            recoveryAttempted = true;
            recoveryBudgetExhausted = attemptCount >= options.maxAttempts;
            errorCode = "delivery_queue_job_state_unsupported";
            result.errors++;

            logger.error("Unsupported notification delivery job state", {
              deliveryId: delivery.id,
              eventId: outboxEvent.id,
              jobId,
              state,
            });
          }
        }
      }
    } catch (error) {
      result.errors++;

      /*
       * If ownership was not lost, distinguish queue inspection failures
       * from failures that happened after a recovery attempt was recorded.
       */
      errorCode = recoveryAttempted
        ? "delivery_reconciliation_recovery_failed"
        : "delivery_reconciliation_inspection_failed";

      logger.error("Notification delivery reconciliation failed", {
        deliveryId: delivery.id,
        eventId: outboxEvent.id,
        jobId,
        recoveryAttempted,
        error,
      });
    } finally {
      try {
        const released =
          await notificationReconciliationRepository.releaseClaim({
            deliveryId: delivery.id,
            workerId: options.workerId,
            retryDelayMs: options.retryDelayMs,
            errorCode,
            exhausted: recoveryAttempted && recoveryBudgetExhausted,
          });

        if (!released) {
          logger.warn(
            "Notification reconciliation ownership was lost before release",
            {
              deliveryId: delivery.id,
              eventId: outboxEvent.id,
              workerId: options.workerId,
            },
          );
        }
      } catch (error) {
        /*
         * If releasing the claim fails, its database lease will eventually
         * expire, allowing another reconciliation worker to take ownership.
         */
        logger.error(
          "Failed to release notification reconciliation ownership",
          {
            deliveryId: delivery.id,
            eventId: outboxEvent.id,
            workerId: options.workerId,
            error,
          },
        );
      }
    }
  }
}

export const notificationReconciliationService =
  new NotificationReconciliationService();
