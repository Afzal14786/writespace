import { and, eq, sql } from "drizzle-orm";

import { db, type DatabaseTransaction } from "../../../db";

import {
  notificationDeliveries,
  type NotificationDelivery,
  type NewNotificationDelivery,
  type NotificationDeliveryStatus,
} from "../../../db/schema/notification-deliveries";

import {
  notificationDeliveryAttempts,
  type NotificationDeliveryAttempt,
  type NotificationDeliveryAttemptOutcome,
} from "../../../db/schema/notification-delivery-attempts";

import { HTTP_STATUS } from "@shared/constants/http-codes";
import { AppError } from "@shared/utils/app.error";

export interface ClaimNotificationDeliveryInput {
  deliveryId: string;
  workerId: string;
  leaseDurationMs: number;
}

export interface RenewNotificationDeliveryLeaseInput {
  deliveryId: string;
  workerId: string;
  attemptNumber: number;
  leaseDurationMs: number;
}

export interface ClaimedNotificationDelivery {
  delivery: NotificationDelivery;
  attempt: NotificationDeliveryAttempt;
}

export type CompletedDeliveryStatus = Exclude<
  NotificationDeliveryStatus,
  "queued" | "processing"
>;

export type CompletedDeliveryOutcome = Exclude<
  NotificationDeliveryAttemptOutcome,
  "processing"
>;

export interface CompleteNotificationDeliveryAttemptInput {
  deliveryId: string;
  workerId: string;
  attemptNumber: number;

  outcome: CompletedDeliveryOutcome;
  status: CompletedDeliveryStatus;

  /**
   * Required when the delivery is eligible for another attempt.
   * The service layer calculates this using the retry policy.
   */
  nextAttemptAt?: Date;

  errorCode?: string | null;
  providerResponseCode?: string | null;
  providerMessageId?: string | null;

  acceptedAt?: Date;
  confirmedDeliveredAt?: Date;
}

/**
 * Manages durable channel-delivery state and individual attempts.
 *
 * The repository owns database consistency only. It does not decide
 * whether a channel is eligible, render email templates, or perform
 * external delivery operations.
 */
export class NotificationDeliveryRepository {
  /**
   * Read PostgreSQL's current clock after the delivery row has been locked.
   *
   * Using the database clock avoids relying on individual worker clocks
   * when checking ownership and calculating delivery leases.
   */
  private async getDatabaseNow(
    transaction: DatabaseTransaction,
    deliveryId: string,
  ): Promise<Date> {
    const [result] = await transaction
      .select({
        now: sql<Date>`clock_timestamp()`,
      })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, deliveryId))
      .limit(1);

    if (!result) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Failed to retrieve database time for notification delivery.",
      );
    }

    return result.now;
  }

  /**
   * Retrieve a delivery by its stable ID.
   */
  public async findById(
    deliveryId: string,
  ): Promise<NotificationDelivery | null> {
    const [delivery] = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, deliveryId))
      .limit(1);

    return delivery ?? null;
  }

  /**
   * Retrieve a delivery inside an existing transaction.
   */
  public async findByIdInTransaction(
    transaction: DatabaseTransaction,
    deliveryId: string,
  ): Promise<NotificationDelivery | null> {
    const [delivery] = await transaction
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, deliveryId))
      .limit(1);

    return delivery ?? null;
  }

  /**
   * Persist a new channel delivery inside the caller's transaction.
   *
   * The caller is responsible for creating the corresponding outbox event
   * in the same transaction so the delivery cannot exist without its
   * durable processing request.
   */
  public async create(
    transaction: DatabaseTransaction,
    input: NewNotificationDelivery,
  ): Promise<NotificationDelivery> {
    const [delivery] = await transaction
      .insert(notificationDeliveries)
      .values(input)
      .returning();

    if (!delivery) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Failed to create notification delivery.",
      );
    }

    return delivery;
  }

  /**
   * Claim one delivery and create its active attempt atomically.
   *
   * Only eligible, due deliveries can be claimed:
   * - queued deliveries;
   * - retryable failures whose retry time has arrived.
   *
   * A row lock prevents two workers from claiming the same delivery
   * concurrently. The lease provides recovery information if a worker
   * terminates unexpectedly.
   *
   * An expired processing lease is treated as an ambiguous outcome.
   * We cannot safely assume that the previous worker did not perform
   * the external action before it crashed.
   */
  public async claimForProcessing(
    input: ClaimNotificationDeliveryInput,
  ): Promise<ClaimedNotificationDelivery | null> {
    const { deliveryId, workerId, leaseDurationMs } = input;

    if (!workerId.trim()) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Delivery worker ID must not be empty.",
      );
    }

    if (!Number.isInteger(leaseDurationMs) || leaseDurationMs < 1) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Delivery lease duration must be a positive integer.",
      );
    }

    return db.transaction(async (transaction) => {
      const [delivery] = await transaction
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.id, deliveryId))
        .limit(1)
        .for("update");

      if (!delivery) {
        return null;
      }

      // Read database time only after acquiring the delivery row lock.
      const now = await this.getDatabaseNow(transaction, deliveryId);
      const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);

      /*
       * Another worker may already own this delivery.
       * Do not start a second attempt while that lease remains valid.
       */
      if (delivery.status === "processing") {
        const leaseHasExpired =
          delivery.leaseExpiresAt === null ||
          delivery.leaseExpiresAt.getTime() <= now.getTime();

        if (!leaseHasExpired) {
          return null;
        }

        // A crashed worker may have completed an external operation
        // without recording its result. Preserve that uncertainty.
        await this.markExpiredLeaseAsUnknown(transaction, delivery, now);

        return null;
      }

      if (
        delivery.status !== "queued" &&
        delivery.status !== "retryable_failed"
      ) {
        return null;
      }

      // Only policy-approved deliveries may reach a channel handler.
      if (delivery.eligibilityDecision !== "eligible") {
        return null;
      }

      // Respect delayed delivery scheduling.
      if (
        delivery.scheduledFor &&
        delivery.scheduledFor.getTime() > now.getTime()
      ) {
        return null;
      }

      // Respect retry scheduling.
      if (
        delivery.nextAttemptAt &&
        delivery.nextAttemptAt.getTime() > now.getTime()
      ) {
        return null;
      }

      /*
       * Expired work must not be sent merely because a queue job
       * still exists. No channel attempt is created in this case.
       */
      if (delivery.expiresAt && delivery.expiresAt.getTime() <= now.getTime()) {
        await transaction
          .update(notificationDeliveries)
          .set({
            status: "permanent_failed",
            nextAttemptAt: null,
            lockedAt: null,
            lockedBy: null,
            leaseExpiresAt: null,
            lastErrorCode: "delivery_expired",
            updatedAt: now,
          })
          .where(eq(notificationDeliveries.id, deliveryId));

        return null;
      }

      const attemptNumber = delivery.attemptCount + 1;

      /*
       * Create the attempt and acquire the delivery lease in the
       * same transaction. Neither change can commit independently.
       */
      const [attempt] = await transaction
        .insert(notificationDeliveryAttempts)
        .values({
          deliveryId: delivery.id,
          attemptNumber,
          outcome: "processing",
          startedAt: now,
        })
        .returning();

      if (!attempt) {
        throw new AppError(
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          "Failed to create notification delivery attempt.",
        );
      }

      const [claimedDelivery] = await transaction
        .update(notificationDeliveries)
        .set({
          status: "processing",
          attemptCount: attemptNumber,
          nextAttemptAt: null,
          lockedAt: now,
          lockedBy: workerId,
          leaseExpiresAt,
          updatedAt: now,
        })
        .where(eq(notificationDeliveries.id, delivery.id))
        .returning();

      if (!claimedDelivery) {
        throw new AppError(
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          "Failed to claim notification delivery.",
        );
      }

      return {
        delivery: claimedDelivery,
        attempt,
      };
    });
  }

  /**
   * Extend the lease of an existing delivery attempt.
   *
   * Renewal is permitted only when:
   * - the delivery is still processing;
   * - the requesting worker owns the delivery;
   * - the attempt number matches the current attempt;
   * - the existing lease has not expired.
   *
   * An expired lease is never revived. It is resolved as unknown
   * because the previous worker may already have performed the
   * external delivery operation.
   */
  public async renewLease(
    input: RenewNotificationDeliveryLeaseInput,
  ): Promise<NotificationDelivery | null> {
    if (!input.workerId.trim()) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Delivery worker ID must not be empty.",
      );
    }

    if (!Number.isSafeInteger(input.attemptNumber) || input.attemptNumber < 1) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Delivery attempt number must be a positive integer.",
      );
    }

    if (
      !Number.isSafeInteger(input.leaseDurationMs) ||
      input.leaseDurationMs < 1
    ) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Delivery lease duration must be a positive integer.",
      );
    }

    return db.transaction(async (transaction) => {
      const [delivery] = await transaction
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.id, input.deliveryId))
        .limit(1)
        .for("update");

      if (
        !delivery ||
        delivery.status !== "processing" ||
        delivery.lockedBy !== input.workerId ||
        delivery.attemptCount !== input.attemptNumber
      ) {
        return null;
      }

      const now = await this.getDatabaseNow(transaction, input.deliveryId);

      /*
       * Do not allow a worker to regain ownership after its lease expires.
       * The previous external operation may already have succeeded.
       */
      if (
        !delivery.leaseExpiresAt ||
        delivery.leaseExpiresAt.getTime() <= now.getTime()
      ) {
        await this.markExpiredLeaseAsUnknown(transaction, delivery, now);

        return null;
      }

      const [activeAttempt] = await transaction
        .select()
        .from(notificationDeliveryAttempts)
        .where(
          and(
            eq(notificationDeliveryAttempts.deliveryId, input.deliveryId),
            eq(notificationDeliveryAttempts.attemptNumber, input.attemptNumber),
            eq(notificationDeliveryAttempts.outcome, "processing"),
          ),
        )
        .limit(1)
        .for("update");

      if (!activeAttempt) {
        throw new AppError(
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          "Active notification delivery attempt was not found.",
        );
      }

      const leaseExpiresAt = new Date(now.getTime() + input.leaseDurationMs);

      const [updatedDelivery] = await transaction
        .update(notificationDeliveries)
        .set({
          leaseExpiresAt,
          updatedAt: now,
        })
        .where(eq(notificationDeliveries.id, delivery.id))
        .returning();

      return updatedDelivery ?? null;
    });
  }

  /**
   * Record the result of a channel attempt and update the delivery state.
   *
   * The worker ID and attempt number are checked before the update so
   * that a stale worker cannot overwrite a newer worker's result.
   */
  public async completeAttempt(
    input: CompleteNotificationDeliveryAttemptInput,
  ): Promise<NotificationDelivery | null> {
    this.validateCompletionInput(input);

    return db.transaction(async (transaction) => {
      const [delivery] = await transaction
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.id, input.deliveryId))
        .limit(1)
        .for("update");

      if (
        !delivery ||
        delivery.status !== "processing" ||
        delivery.lockedBy !== input.workerId ||
        delivery.attemptCount !== input.attemptNumber
      ) {
        return null;
      }

      const now = await this.getDatabaseNow(transaction, input.deliveryId);

      /*
       * A worker must not complete an attempt after its lease expires.
       * Preserve uncertainty rather than accepting a potentially stale result.
       */
      if (
        !delivery.leaseExpiresAt ||
        delivery.leaseExpiresAt.getTime() <= now.getTime()
      ) {
        await this.markExpiredLeaseAsUnknown(transaction, delivery, now);

        return null;
      }

      const [attempt] = await transaction
        .select()
        .from(notificationDeliveryAttempts)
        .where(
          and(
            eq(notificationDeliveryAttempts.deliveryId, input.deliveryId),
            eq(notificationDeliveryAttempts.attemptNumber, input.attemptNumber),
            eq(notificationDeliveryAttempts.outcome, "processing"),
          ),
        )
        .limit(1)
        .for("update");

      if (!attempt) {
        throw new AppError(
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          "Active notification delivery attempt was not found.",
        );
      }

      const latencyMs = Math.max(
        0,
        now.getTime() - attempt.startedAt.getTime(),
      );

      const attemptUpdate: Partial<
        typeof notificationDeliveryAttempts.$inferInsert
      > = {
        outcome: input.outcome,
        completedAt: now,
        latencyMs,
        errorCode: input.errorCode ?? null,
      };

      if (input.providerResponseCode !== undefined) {
        attemptUpdate.providerResponseCode = input.providerResponseCode;
      }

      if (input.providerMessageId !== undefined) {
        attemptUpdate.providerMessageId = input.providerMessageId;
      }

      await transaction
        .update(notificationDeliveryAttempts)
        .set(attemptUpdate)
        .where(eq(notificationDeliveryAttempts.id, attempt.id));

      const deliveryUpdate: Partial<
        typeof notificationDeliveries.$inferInsert
      > = {
        status: input.status,
        nextAttemptAt:
          input.status === "retryable_failed" ? input.nextAttemptAt! : null,
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        lastErrorCode: input.errorCode ?? null,
        updatedAt: now,
      };

      if (input.acceptedAt !== undefined) {
        deliveryUpdate.acceptedAt = input.acceptedAt;
      } else if (input.outcome === "accepted") {
        deliveryUpdate.acceptedAt = now;
      }

      if (input.confirmedDeliveredAt !== undefined) {
        deliveryUpdate.confirmedDeliveredAt = input.confirmedDeliveredAt;
      } else if (input.outcome === "delivered") {
        deliveryUpdate.confirmedDeliveredAt = now;
      }

      if (input.providerMessageId !== undefined) {
        deliveryUpdate.providerMessageId = input.providerMessageId;
      }

      const [updatedDelivery] = await transaction
        .update(notificationDeliveries)
        .set(deliveryUpdate)
        .where(eq(notificationDeliveries.id, delivery.id))
        .returning();

      if (!updatedDelivery) {
        throw new AppError(
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          "Failed to update notification delivery state.",
        );
      }

      return updatedDelivery;
    });
  }

  /**
   * Resolve a worker lease that expired without a recorded outcome.
   *
   * The attempt becomes ambiguous and the delivery becomes unknown.
   * Automatic retry is intentionally not performed because the previous
   * channel action may already have succeeded.
   */
  private async markExpiredLeaseAsUnknown(
    transaction: DatabaseTransaction,
    delivery: NotificationDelivery,
    now: Date,
  ): Promise<void> {
    const [activeAttempt] = await transaction
      .select()
      .from(notificationDeliveryAttempts)
      .where(
        and(
          eq(notificationDeliveryAttempts.deliveryId, delivery.id),
          eq(notificationDeliveryAttempts.attemptNumber, delivery.attemptCount),
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

  /**
   * Enforce the relationship between an attempt outcome and the
   * resulting delivery state.
   *
   * For example, an ambiguous external result must not be represented
   * as a successful delivery or as a normal retryable failure.
   */
  private validateCompletionInput(
    input: CompleteNotificationDeliveryAttemptInput,
  ): void {
    if (input.status === "retryable_failed" && !input.nextAttemptAt) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "A retryable delivery failure requires a next attempt time.",
      );
    }

    if (input.status !== "retryable_failed" && input.nextAttemptAt) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "A next attempt time is only valid for retryable failures.",
      );
    }

    const validStatusByOutcome: Record<
      CompletedDeliveryOutcome,
      CompletedDeliveryStatus[]
    > = {
      accepted: ["accepted"],
      delivered: ["delivered"],
      transient_failure: ["retryable_failed", "dead_lettered"],
      permanent_failure: ["permanent_failed"],
      ambiguous: ["unknown"],
      suppressed: ["suppressed"],
    };

    if (!validStatusByOutcome[input.outcome].includes(input.status)) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Notification delivery attempt outcome does not match its delivery status.",
      );
    }

    if (!input.workerId.trim()) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Delivery worker ID must not be empty.",
      );
    }

    if (!Number.isInteger(input.attemptNumber) || input.attemptNumber < 1) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Delivery attempt number must be a positive integer.",
      );
    }
  }
}

export const notificationDeliveryRepository =
  new NotificationDeliveryRepository();
