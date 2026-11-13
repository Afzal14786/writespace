import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";

import { db, type DatabaseTransaction } from "../../../db";

import {
  outboxEvents,
  type NewOutboxEvent,
  type OutboxEvent,
} from "../../../db/schema/outbox-events";

import { HTTP_STATUS } from "@shared/constants/http-codes";
import { AppError } from "@shared/utils/app.error";

export interface ClaimOutboxEventsOptions {
  workerId: string;
  batchSize: number;
  leaseDurationMs: number;
}

export interface RecordDispatchFailureInput {
  eventId: string;
  workerId: string;
  attemptCount: number;
  maxAttempts: number;
  errorMessage: string;
  retryAt: Date;
}

/**
 * Persists and manages events in the transactional outbox.
 *
 * Domain operations use create() with their existing transaction.
 * Dispatcher operations use separate, short-lived transactions.
 */
export class OutboxRepository {
  /**
   * Insert an event into the caller's active PostgreSQL transaction.
   *
   * This keeps the domain operation and its event record atomic.
   */
  public async create(
    transaction: DatabaseTransaction,
    input: NewOutboxEvent,
  ): Promise<OutboxEvent> {
    const [event] = await transaction
      .insert(outboxEvents)
      .values(input)
      .returning();

    if (!event) {
      // PostgreSQL should return the inserted row. If it does not, the
      // repository cannot fulfil its contract.
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Failed to create outbox event.",
      );
    }

    return event;
  }

  /**
   * Retrieve an event inside the consumer's transaction.
   *
   * Event validation, idempotency recording, and notification persistence
   * can all participate in the same transaction.
   */
  public async findById(
    transaction: DatabaseTransaction,
    eventId: string,
  ): Promise<OutboxEvent | null> {
    const [event] = await transaction
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId))
      .limit(1);

    return event ?? null;
  }

  /**
   * Claim a batch of dispatchable events.
   *
   * Eligible rows:
   * 1. PENDING events whose availableAt time has arrived.
   * 2. PROCESSING events whose lease has expired.
   *
   * FOR UPDATE SKIP LOCKED lets multiple dispatcher instances claim
   * different rows without waiting on one another.
   */
  public async claimBatch(
    options: ClaimOutboxEventsOptions,
  ): Promise<OutboxEvent[]> {
    const { workerId, batchSize, leaseDurationMs } = options;

    if (!workerId.trim()) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Outbox dispatcher worker ID must not be empty.",
      );
    }

    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Outbox batch size must be a positive integer.",
      );
    }

    if (!Number.isInteger(leaseDurationMs) || leaseDurationMs < 1) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Outbox lease duration must be a positive integer.",
      );
    }

    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);

    return db.transaction(async (transaction) => {
      const eligibleEvents = await transaction
        .select()
        .from(outboxEvents)
        .where(
          or(
            and(
              eq(outboxEvents.status, "PENDING"),
              lte(outboxEvents.availableAt, now),
            ),
            and(
              eq(outboxEvents.status, "PROCESSING"),
              lt(outboxEvents.leaseExpiresAt, now),
            ),
          ),
        )
        .orderBy(asc(outboxEvents.availableAt), asc(outboxEvents.createdAt))
        .limit(batchSize)
        .for("update", {
          skipLocked: true,
        });

      if (eligibleEvents.length === 0) {
        return [];
      }

      const eventIds = eligibleEvents.map((event) => event.id);

      // Update the selected rows before releasing their row locks.
      return transaction
        .update(outboxEvents)
        .set({
          status: "PROCESSING",
          lockedAt: now,
          lockedBy: workerId,
          leaseExpiresAt,
          attemptCount: sql`${outboxEvents.attemptCount} + 1`,
          lastAttemptAt: now,
          lastError: null,
          updatedAt: now,
        })
        .where(inArray(outboxEvents.id, eventIds))
        .returning();
    });
  }

  /**
   * Mark an event as published after BullMQ accepts its job.
   *
   * The worker ID and status checks ensure that an expired dispatcher
   * cannot change a row that has been claimed by a newer dispatcher.
   */
  public async markPublished(
    eventId: string,
    workerId: string,
  ): Promise<boolean> {
    const now = new Date();

    const updatedEvents = await db
      .update(outboxEvents)
      .set({
        status: "PUBLISHED",
        publishedAt: now,
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        lastError: null,
        failedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(outboxEvents.id, eventId),
          eq(outboxEvents.status, "PROCESSING"),
          eq(outboxEvents.lockedBy, workerId),
        ),
      )
      .returning({
        id: outboxEvents.id,
      });

    return updatedEvents.length === 1;
  }

  /**
   * Record a failed attempt to hand an event off to BullMQ.
   *
   * The event returns to PENDING when attempts remain, or moves to FAILED
   * when the configured dispatch-attempt limit has been reached.
   */
  public async markDispatchFailure(
    input: RecordDispatchFailureInput,
  ): Promise<boolean> {
    const now = new Date();
    const isTerminalFailure = input.attemptCount >= input.maxAttempts;

    const updatedEvents = await db
      .update(outboxEvents)
      .set({
        status: isTerminalFailure ? "FAILED" : "PENDING",
        availableAt: input.retryAt,
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        lastError: input.errorMessage.slice(0, 4000),
        failedAt: isTerminalFailure ? now : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(outboxEvents.id, input.eventId),
          eq(outboxEvents.status, "PROCESSING"),
          eq(outboxEvents.lockedBy, input.workerId),
        ),
      )
      .returning({
        id: outboxEvents.id,
      });

    return updatedEvents.length === 1;
  }
}

export const outboxRepository = new OutboxRepository();
