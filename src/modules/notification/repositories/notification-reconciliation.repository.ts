import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { db } from "../../../db";

import {
  notificationDeliveries,
  type NotificationDelivery,
} from "../../../db/schema/notification-deliveries";

import { notificationDeliveryAttempts } from "../../../db/schema/notification-delivery-attempts";

import {
  outboxEvents,
  type OutboxEvent,
} from "../../../db/schema/outbox-events";

import { HTTP_STATUS } from "@shared/constants/http-codes";
import { AppError } from "@shared/utils/app.error";

/**
 * The reconciliation process only repairs delivery requests that have
 * already been successfully handed off to the delivery queue.
 */
const DELIVERY_REQUESTED_EVENT = "notification.delivery.requested";
const DELIVERY_AGGREGATE_TYPE = "notification_delivery";

const OUTBOX_FAILED_MANUAL_RECOVERY_ERROR =
  "outbox_event_failed_manual_recovery_required";

export interface ClaimNotificationReconciliationInput {
  workerId: string;
  batchSize: number;
  leaseDurationMs: number;
  initialGracePeriodMs: number;
  maxAttempts: number;
}

export interface ClaimedNotificationReconciliation {
  delivery: NotificationDelivery;
  outboxEvent: OutboxEvent;
}

export interface MarkNotificationReconciliationAttemptInput {
  deliveryId: string;
  workerId: string;
  maxAttempts: number;
}

export interface ReleaseNotificationReconciliationInput {
  deliveryId: string;
  workerId: string;
  retryDelayMs: number;
  errorCode?: string | null;
  exhausted?: boolean;
}

/**
 * Manages database-side notification delivery recovery.
 *
 * This repository does not publish jobs or execute channel handlers.
 * Its responsibility is to provide safe ownership and recovery state
 * for the reconciliation service.
 */
export class NotificationReconciliationRepository {
  private validatePositiveInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        `${name} must be a positive safe integer.`,
      );
    }
  }

  /**
   * Resolve processing deliveries whose actual delivery-worker lease
   * has expired.
   *
   * Their previous external operation may already have succeeded.
   * Therefore the attempt becomes ambiguous and the delivery becomes
   * unknown instead of being automatically retried.
   */
  public async resolveExpiredProcessingLeases(
    batchSize: number,
  ): Promise<number> {
    this.validatePositiveInteger(batchSize, "Batch size");

    return db.transaction(async (transaction) => {
      const expiredDeliveries = await transaction
        .select()
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.status, "processing"),
            lte(notificationDeliveries.leaseExpiresAt, sql`clock_timestamp()`),
          ),
        )
        .orderBy(asc(notificationDeliveries.leaseExpiresAt))
        .limit(batchSize)
        .for("update", { skipLocked: true });

      for (const delivery of expiredDeliveries) {
        const [clock] = await transaction
          .select({
            now: sql<Date>`clock_timestamp()`,
          })
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.id, delivery.id))
          .limit(1);

        if (!clock) {
          throw new AppError(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            "Failed to retrieve database time during delivery recovery.",
          );
        }

        const now = clock.now;

        const [activeAttempt] = await transaction
          .select()
          .from(notificationDeliveryAttempts)
          .where(
            and(
              eq(notificationDeliveryAttempts.deliveryId, delivery.id),
              eq(
                notificationDeliveryAttempts.attemptNumber,
                delivery.attemptCount,
              ),
              eq(notificationDeliveryAttempts.outcome, "processing"),
            ),
          )
          .limit(1)
          .for("update");

        if (activeAttempt) {
          await transaction
            .update(notificationDeliveryAttempts)
            .set({
              outcome: "ambiguous",
              completedAt: now,
              latencyMs: Math.max(
                0,
                now.getTime() - activeAttempt.startedAt.getTime(),
              ),
              errorCode: "worker_lease_expired",
            })
            .where(eq(notificationDeliveryAttempts.id, activeAttempt.id));
        }

        await transaction
          .update(notificationDeliveries)
          .set({
            status: "unknown",
            nextAttemptAt: null,
            lockedAt: null,
            lockedBy: null,
            leaseExpiresAt: null,
            lastErrorCode: "worker_lease_expired",
            updatedAt: now,
          })
          .where(eq(notificationDeliveries.id, delivery.id));
      }

      return expiredDeliveries.length;
    });
  }

  /**
   * Expire deliveries that have passed their useful lifetime.
   *
   * No channel attempt is created. An expired notification must not
   * be sent merely because a stale queue job still exists.
   */
  public async expireDueDeliveries(batchSize: number): Promise<number> {
    this.validatePositiveInteger(batchSize, "Batch size");

    return db.transaction(async (transaction) => {
      const expiredDeliveries = await transaction
        .select()
        .from(notificationDeliveries)
        .where(
          and(
            inArray(notificationDeliveries.status, [
              "queued",
              "retryable_failed",
            ]),
            lte(notificationDeliveries.expiresAt, sql`clock_timestamp()`),
            or(
              isNull(notificationDeliveries.reconciliationLeaseExpiresAt),
              lte(
                notificationDeliveries.reconciliationLeaseExpiresAt,
                sql`clock_timestamp()`,
              ),
            ),
          ),
        )
        .orderBy(asc(notificationDeliveries.expiresAt))
        .limit(batchSize)
        .for("update", { skipLocked: true });

      for (const delivery of expiredDeliveries) {
        await transaction
          .update(notificationDeliveries)
          .set({
            status: "permanent_failed",
            nextAttemptAt: null,
            lockedAt: null,
            lockedBy: null,
            leaseExpiresAt: null,
            reconciliationLockedAt: null,
            reconciliationLockedBy: null,
            reconciliationLeaseExpiresAt: null,
            nextReconciliationAt: null,
            reconciliationLastError: "delivery_expired",
            lastErrorCode: "delivery_expired",
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(notificationDeliveries.id, delivery.id));
      }

      return expiredDeliveries.length;
    });
  }

  /**
   * Claim eligible delivery records for queue reconciliation.
   *
   * Only published delivery-request outbox events are considered.
   * PENDING and PROCESSING outbox records remain the responsibility
   * of the existing outbox dispatcher.
   *
   * SKIP LOCKED permits multiple reconciliation workers to operate
   * without claiming the same database row.
   *
   * Claiming a record does not consume the recovery budget. The budget
   * is incremented separately, immediately before an actual recovery
   * or bounded diagnostic intervention is attempted.
   */
  public async claimDueDeliveries(
    input: ClaimNotificationReconciliationInput,
  ): Promise<ClaimedNotificationReconciliation[]> {
    if (!input.workerId.trim()) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Reconciliation worker ID must not be empty.",
      );
    }

    this.validatePositiveInteger(input.batchSize, "Batch size");

    this.validatePositiveInteger(
      input.leaseDurationMs,
      "Reconciliation lease duration",
    );

    this.validatePositiveInteger(
      input.initialGracePeriodMs,
      "Initial grace period",
    );

    this.validatePositiveInteger(input.maxAttempts, "Maximum attempts");

    return db.transaction(async (transaction) => {
      const candidates = await transaction
        .select({
          delivery: notificationDeliveries,
          outboxEvent: outboxEvents,
        })
        .from(notificationDeliveries)
        .innerJoin(
          outboxEvents,
          and(
            eq(outboxEvents.eventName, DELIVERY_REQUESTED_EVENT),
            eq(outboxEvents.aggregateType, DELIVERY_AGGREGATE_TYPE),
            sql`${outboxEvents.aggregateId} = ${notificationDeliveries.id}::text`,
            eq(outboxEvents.status, "PUBLISHED"),
          ),
        )
        .where(
          and(
            inArray(notificationDeliveries.status, [
              "queued",
              "retryable_failed",
            ]),
            eq(notificationDeliveries.eligibilityDecision, "eligible"),

            // Respect delayed delivery scheduling and retry timestamps.
            or(
              isNull(notificationDeliveries.scheduledFor),
              lte(notificationDeliveries.scheduledFor, sql`clock_timestamp()`),
            ),

            or(
              isNull(notificationDeliveries.nextAttemptAt),
              lte(notificationDeliveries.nextAttemptAt, sql`clock_timestamp()`),
            ),

            // Do not inspect a newly created delivery prematurely.
            or(
              and(
                isNull(notificationDeliveries.nextReconciliationAt),
                lte(
                  notificationDeliveries.createdAt,
                  sql`clock_timestamp() - (${input.initialGracePeriodMs} * interval '1 millisecond')`,
                ),
              ),
              lte(
                notificationDeliveries.nextReconciliationAt,
                sql`clock_timestamp()`,
              ),
            ),

            // Expired delivery requests are handled separately.
            or(
              isNull(notificationDeliveries.expiresAt),
              gt(notificationDeliveries.expiresAt, sql`clock_timestamp()`),
            ),

            // Allow recovery after a previous reconciliation worker crashed.
            or(
              isNull(notificationDeliveries.reconciliationLeaseExpiresAt),
              lte(
                notificationDeliveries.reconciliationLeaseExpiresAt,
                sql`clock_timestamp()`,
              ),
            ),

            // Bound automatic recovery operations, not healthy inspections.
            lt(
              notificationDeliveries.reconciliationAttemptCount,
              input.maxAttempts,
            ),
          ),
        )
        .orderBy(asc(notificationDeliveries.createdAt))
        .limit(input.batchSize)
        .for("update", {
          of: notificationDeliveries,
          skipLocked: true,
        });

      const claimed: ClaimedNotificationReconciliation[] = [];

      for (const candidate of candidates) {
        const [updatedDelivery] = await transaction
          .update(notificationDeliveries)
          .set({
            // All three reconciliation lease fields are required by
            // notification_deliveries_reconciliation_lease_state_check.
            reconciliationLockedAt: sql`clock_timestamp()`,
            reconciliationLockedBy: input.workerId,
            reconciliationLeaseExpiresAt: sql`clock_timestamp() + (${input.leaseDurationMs} * interval '1 millisecond')`,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(notificationDeliveries.id, candidate.delivery.id))
          .returning();

        if (updatedDelivery) {
          claimed.push({
            delivery: updatedDelivery,
            outboxEvent: candidate.outboxEvent,
          });
        }
      }

      return claimed;
    });
  }

  /**
   * Durably consume one bounded recovery attempt before mutating BullMQ.
   *
   * Recording the counter before a recovery operation means a process
   * crash after a queue mutation cannot silently reset the recovery budget.
   *
   * Returns the new count, or null if this worker no longer owns an active
   * reconciliation lease or the configured budget has already been used.
   */
  public async markRecoveryAttempt(
    input: MarkNotificationReconciliationAttemptInput,
  ): Promise<number | null> {
    if (!input.workerId.trim()) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Reconciliation worker ID must not be empty.",
      );
    }

    this.validatePositiveInteger(input.maxAttempts, "Maximum attempts");

    const [updated] = await db
      .update(notificationDeliveries)
      .set({
        reconciliationAttemptCount: sql`${notificationDeliveries.reconciliationAttemptCount} + 1`,
        reconciliationLastAttemptAt: sql`clock_timestamp()`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(notificationDeliveries.id, input.deliveryId),
          eq(notificationDeliveries.reconciliationLockedBy, input.workerId),
          gt(
            notificationDeliveries.reconciliationLeaseExpiresAt,
            sql`clock_timestamp()`,
          ),
          lt(
            notificationDeliveries.reconciliationAttemptCount,
            input.maxAttempts,
          ),
        ),
      )
      .returning({
        attemptCount: notificationDeliveries.reconciliationAttemptCount,
      });

    return updated?.attemptCount ?? null;
  }

  /**
   * Release reconciliation ownership after inspecting or repairing a job.
   *
   * The recovery counter is deliberately not incremented here. It is
   * durably incremented by markRecoveryAttempt() before queue mutation.
   */
  public async releaseClaim(
    input: ReleaseNotificationReconciliationInput,
  ): Promise<boolean> {
    if (!input.workerId.trim()) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Reconciliation worker ID must not be empty.",
      );
    }

    if (!input.exhausted) {
      this.validatePositiveInteger(input.retryDelayMs, "Retry delay");
    }

    const [released] = await db
      .update(notificationDeliveries)
      .set({
        reconciliationLockedAt: null,
        reconciliationLockedBy: null,
        reconciliationLeaseExpiresAt: null,

        nextReconciliationAt: input.exhausted
          ? null
          : sql`clock_timestamp() + (${input.retryDelayMs} * interval '1 millisecond')`,

        reconciliationLastError: input.errorCode ?? null,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(notificationDeliveries.id, input.deliveryId),
          eq(notificationDeliveries.reconciliationLockedBy, input.workerId),
          gt(
            notificationDeliveries.reconciliationLeaseExpiresAt,
            sql`clock_timestamp()`,
          ),
        ),
      )
      .returning({ id: notificationDeliveries.id });

    return Boolean(released);
  }

  /**
   * Identify delivery requests whose outbox handoff permanently failed.
   *
   * These events require operator intervention. They must not be
   * automatically republished by the delivery reconciliation process.
   *
   * The diagnostic marker prevents repeated warnings on every cycle.
   */
  public async flagFailedOutboxDeliveries(
    batchSize: number,
  ): Promise<Array<{ deliveryId: string; eventId: string }>> {
    this.validatePositiveInteger(batchSize, "Batch size");

    return db.transaction(async (transaction) => {
      const candidates = await transaction
        .select({
          deliveryId: notificationDeliveries.id,
          eventId: outboxEvents.id,
        })
        .from(notificationDeliveries)
        .innerJoin(
          outboxEvents,
          and(
            eq(outboxEvents.eventName, DELIVERY_REQUESTED_EVENT),
            eq(outboxEvents.aggregateType, DELIVERY_AGGREGATE_TYPE),
            sql`${outboxEvents.aggregateId} = ${notificationDeliveries.id}::text`,
            eq(outboxEvents.status, "FAILED"),
          ),
        )
        .where(
          and(
            inArray(notificationDeliveries.status, [
              "queued",
              "retryable_failed",
            ]),
            eq(notificationDeliveries.eligibilityDecision, "eligible"),
            or(
              isNull(notificationDeliveries.reconciliationLockedBy),
              lte(
                notificationDeliveries.reconciliationLeaseExpiresAt,
                sql`clock_timestamp()`,
              ),
            ),
            or(
              isNull(notificationDeliveries.reconciliationLastError),
              ne(
                notificationDeliveries.reconciliationLastError,
                OUTBOX_FAILED_MANUAL_RECOVERY_ERROR,
              ),
            ),
          ),
        )
        .orderBy(asc(outboxEvents.failedAt))
        .limit(batchSize)
        .for("update", {
          of: notificationDeliveries,
          skipLocked: true,
        });

      for (const candidate of candidates) {
        await transaction
          .update(notificationDeliveries)
          .set({
            reconciliationLastError: OUTBOX_FAILED_MANUAL_RECOVERY_ERROR,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(notificationDeliveries.id, candidate.deliveryId));
      }

      return candidates;
    });
  }
}

export const notificationReconciliationRepository =
  new NotificationReconciliationRepository();
