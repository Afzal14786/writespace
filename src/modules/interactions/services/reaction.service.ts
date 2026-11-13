import env from "@config/env";
import logger from "@config/logger";

import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";

import { db, type DatabaseTransaction } from "../../../db";

import { eventPublisherService } from "@modules/notification/services/event-publisher.service";

import { interactionEventMapper } from "../events/interaction-event.mapper";
import { interactionEventPublisher } from "../events/interaction-event.publisher";
import { reactionRepository } from "../repositories/reaction.repository";

import type {
  ReactionResult,
  RemoveReactionInput,
  SetReactionInput,
  ReactionTargetType,
  ReactionType,
} from "../contracts/reaction.types";

type ReactionEventType =
  | "reaction.added"
  | "reaction.changed"
  | "reaction.removed";

/**
 * The content-item identifier is shared by Posts and Articles.
 * Legacy POST targets are normalized before entering the outbox.
 */
type NotificationReactionTargetType = "CONTENT_ITEM" | "COMMENT";

/**
 * Describes a reaction operation that actually changed persisted state.
 */
interface ReactionMutation {
  eventType: ReactionEventType;
  reactionType: ReactionType;
}

/**
 * Coordinates reaction persistence, notification event creation,
 * and the existing interaction-history publisher.
 *
 * The business change and outbox event share one PostgreSQL transaction.
 * Interaction history is still written after commit as a separate,
 * best-effort operation, preserving the existing behaviour.
 */
class ReactionService {
  /**
   * Determine whether the reaction belongs to a comment.
   *
   * POST and CONTENT_ITEM represent shared content.
   * POST remains supported as a legacy alias.
   */
  private isCommentTarget(targetType: ReactionTargetType): boolean {
    return targetType === "COMMENT";
  }

  /**
   * Normalize the legacy POST target for the notification event contract.
   *
   * The existing interaction-event mapper already performs this
   * normalization for interaction history.
   */
  private normalizeNotificationTarget(
    targetType: ReactionTargetType,
  ): NotificationReactionTargetType {
    return targetType === "COMMENT" ? "COMMENT" : "CONTENT_ITEM";
  }

  /**
   * Record a reaction domain event in the same transaction as the
   * underlying reaction mutation.
   *
   * The feature flag allows the old interaction-history path to remain
   * available while the new notification pipeline is being rolled out.
   *
   * When enabled, a failure to persist this event aborts the transaction
   * and rolls back the reaction change as well.
   */
  private async recordReactionDomainEvent(
    transaction: DatabaseTransaction,
    eventType: ReactionEventType,
    input: {
      actorId: string;
      targetId: string;
      targetType: ReactionTargetType;
      reactionType: ReactionType;
    },
  ): Promise<void> {
    if (!env.OUTBOX_PROCESSING_ENABLED) {
      return;
    }

    const normalizedTargetType = this.normalizeNotificationTarget(
      input.targetType,
    );

    await eventPublisherService.recordInTransaction(transaction, {
      eventName: eventType,
      producer: "interactions.reactions",
      actorId: input.actorId,

      aggregate: {
        type: normalizedTargetType,
        id: input.targetId,
      },

      payload: {
        targetType: normalizedTargetType,
        targetId: input.targetId,
        reactionType: input.reactionType,
      },
    });
  }

  /**
   * Publish to the existing interaction-history table after the primary
   * transaction commits.
   *
   * This remains best-effort, just as it was before the outbox integration.
   * The durable notification event is recorded separately in the transaction.
   */
  private async publishInteractionHistory(
    eventType: ReactionEventType,
    input: {
      actorId: string;
      targetId: string;
      targetType: ReactionTargetType;
      reactionType: ReactionType;
    },
  ): Promise<void> {
    const event = interactionEventMapper.mapReactionEvent(eventType, input);

    try {
      await interactionEventPublisher.publish(event);
    } catch (error: unknown) {
      logger.error(`Failed to publish ${eventType} interaction history`, {
        actorId: input.actorId,
        targetId: input.targetId,
        targetType: input.targetType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Set or change a user's reaction.
   *
   * Persistence routing:
   * CONTENT_ITEM / POST -> content_reactions
   * COMMENT             -> comment_reactions
   *
   * New content-item reactions are accepted only for published
   * Posts and Articles. The repository validates this inside
   * the transaction.
   *
   * The reaction mutation and corresponding outbox event commit together.
   */
  public async setReaction(input: SetReactionInput): Promise<ReactionResult> {
    const { actorId, targetId, targetType, reactionType } = input;

    const isComment = this.isCommentTarget(targetType);

    const operation = await db.transaction(async (transaction) => {
      const result = isComment
        ? await reactionRepository.setCommentReaction(
            targetId,
            actorId,
            reactionType,
            transaction,
          )
        : await reactionRepository.setContentItemReaction(
            targetId,
            actorId,
            reactionType,
            transaction,
          );

      if (!result) {
        return null;
      }

      // An identical reaction is idempotent: no new outbox event or
      // interaction-history event should be created.
      if (result.previousReactionType === reactionType) {
        return {
          result,
          mutation: null,
        };
      }

      const eventType: ReactionEventType =
        result.previousReactionType === null
          ? "reaction.added"
          : "reaction.changed";

      await this.recordReactionDomainEvent(transaction, eventType, {
        actorId,
        targetId,
        targetType,
        reactionType,
      });

      return {
        result,
        mutation: {
          eventType,
          reactionType,
        } satisfies ReactionMutation,
      };
    });

    if (!operation) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Content not found");
    }

    if (operation.mutation) {
      await this.publishInteractionHistory(operation.mutation.eventType, {
        actorId,
        targetId,
        targetType,
        reactionType: operation.mutation.reactionType,
      });
    }

    return {
      targetId,
      targetType,
      reactionType: operation.result.reaction?.reactionType ?? null,
      isReacted: true,
    };
  }

  /**
   * Remove a user's reaction.
   *
   * Removing a reaction is idempotent. If no reaction exists,
   * no counter is changed and no event is published.
   *
   * The deletion, counter update and outbox event share a transaction.
   */
  public async removeReaction(
    input: RemoveReactionInput,
  ): Promise<ReactionResult> {
    const { actorId, targetId, targetType } = input;

    const isComment = this.isCommentTarget(targetType);

    const deleted = await db.transaction(async (transaction) => {
      const removedReaction = isComment
        ? await reactionRepository.deleteCommentReaction(
            targetId,
            actorId,
            transaction,
          )
        : await reactionRepository.deleteContentItemReaction(
            targetId,
            actorId,
            transaction,
          );

      if (!removedReaction) {
        return null;
      }

      await this.recordReactionDomainEvent(transaction, "reaction.removed", {
        actorId,
        targetId,
        targetType,
        reactionType: removedReaction.reactionType,
      });

      return removedReaction;
    });

    if (!deleted) {
      return {
        targetId,
        targetType,
        reactionType: null,
        isReacted: false,
      };
    }

    await this.publishInteractionHistory("reaction.removed", {
      actorId,
      targetId,
      targetType,
      reactionType: deleted.reactionType,
    });

    return {
      targetId,
      targetType,
      reactionType: null,
      isReacted: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Generic content-item reactions
  // ---------------------------------------------------------------------------

  /**
   * Set a specific reaction on a published Post or Article.
   */
  public async setContentItemReaction(
    actorId: string,
    contentItemId: string,
    reactionType: SetReactionInput["reactionType"],
  ): Promise<ReactionResult> {
    return this.setReaction({
      actorId,
      targetId: contentItemId,
      targetType: "CONTENT_ITEM",
      reactionType,
    });
  }

  /**
   * Remove a reaction from a Post or Article.
   */
  public async removeContentItemReaction(
    actorId: string,
    contentItemId: string,
  ): Promise<ReactionResult> {
    return this.removeReaction({
      actorId,
      targetId: contentItemId,
      targetType: "CONTENT_ITEM",
    });
  }

  /**
   * Atomically toggle Like on a Post or Article.
   *
   * The repository mutation, aggregate counter update and outbox event
   * are committed together.
   */
  public async toggleContentItemLike(
    actorId: string,
    contentItemId: string,
  ): Promise<ReactionResult> {
    const result = await db.transaction(async (transaction) => {
      const mutation = await reactionRepository.toggleContentItemLike(
        contentItemId,
        actorId,
        transaction,
      );

      if (!mutation) {
        return null;
      }

      const eventType: ReactionEventType =
        mutation.action === "added"
          ? "reaction.added"
          : mutation.action === "changed"
            ? "reaction.changed"
            : "reaction.removed";

      // For removal, reactionType is null in the returned state. The event
      // must carry the previous type so its payload still satisfies the
      // registered reaction event schema.
      const eventReactionType =
        mutation.action === "removed"
          ? mutation.previousReactionType
          : mutation.reactionType;

      await this.recordReactionDomainEvent(transaction, eventType, {
        actorId,
        targetId: contentItemId,
        targetType: "CONTENT_ITEM",
        reactionType: eventReactionType,
      });

      return {
        mutation,
        eventType,
        eventReactionType,
      };
    });

    if (!result) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Content not found");
    }

    await this.publishInteractionHistory(result.eventType, {
      actorId,
      targetId: contentItemId,
      targetType: "CONTENT_ITEM",
      reactionType: result.eventReactionType,
    });

    return {
      targetId: contentItemId,
      targetType: "CONTENT_ITEM",
      reactionType: result.mutation.reactionType,
      isReacted: result.mutation.action !== "removed",
    };
  }
}

export const reactionService = new ReactionService();
