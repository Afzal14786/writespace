import { and, eq } from "drizzle-orm";

import type { DatabaseTransaction } from "../../../db";
import {
  processedEvents,
  type ProcessedEventOutcome,
} from "../../../db/schema/processed-events";

import { HTTP_STATUS } from "@shared/constants/http-codes";
import { AppError } from "@shared/utils/app.error";

export type TerminalProcessedEventOutcome = Exclude<
  ProcessedEventOutcome,
  "processing"
>;

/**
 * Records processing progress and the final outcome of an event
 * for a particular consumer.
 *
 * The consumer name is part of the primary key. Multiple independent
 * consumers can therefore process the same event independently.
 */
export class ProcessedEventRepository {
  /**
   * Reserve an event for this consumer inside the caller's transaction.
   *
   * The marker remains uncommitted while processing is in progress.
   * If processing fails, the surrounding transaction rolls it back,
   * allowing a later retry.
   */
  public async tryMarkProcessed(
    transaction: DatabaseTransaction,
    consumerName: string,
    eventId: string,
  ): Promise<boolean> {
    if (!consumerName.trim()) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Processed-event consumer name must not be empty.",
      );
    }

    const inserted = await transaction
      .insert(processedEvents)
      .values({
        consumerName,
        eventId,
        outcome: "processing",
      })
      .onConflictDoNothing()
      .returning({
        eventId: processedEvents.eventId,
      });

    return inserted.length === 1;
  }

  /**
   * Store the terminal processing outcome.
   *
   * This update must happen in the same transaction as the notification
   * or group changes protected by the processed-event marker.
   */
  public async setOutcome(
    transaction: DatabaseTransaction,
    consumerName: string,
    eventId: string,
    outcome: TerminalProcessedEventOutcome,
  ): Promise<void> {
    const [updated] = await transaction
      .update(processedEvents)
      .set({
        outcome,
      })
      .where(
        and(
          eq(processedEvents.consumerName, consumerName),
          eq(processedEvents.eventId, eventId),
          eq(processedEvents.outcome, "processing"),
        ),
      )
      .returning({
        eventId: processedEvents.eventId,
      });

    if (!updated) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Failed to record the processed-event outcome.",
      );
    }
  }
}

export const processedEventRepository = new ProcessedEventRepository();
