import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";

import logger from "@config/logger";

import { interactionEventMapper } from "../events/interaction-event.mapper";
import { interactionEventPublisher } from "../events/interaction-event.publisher";
import { reactionRepository } from "../repositories/reaction.repository";

import type {
  ReactionResult,
  RemoveReactionInput,
  SetReactionInput,
  ReactionTargetType,
} from "../contracts/reaction.types";

type ReactionEventType =
  | "reaction.added"
  | "reaction.changed"
  | "reaction.removed";

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
   * Set or change a user's reaction.
   *
   * Persistence routing:
   * CONTENT_ITEM / POST -> content_reactions
   * COMMENT             -> comment_reactions
   *
   * New content-item reactions are accepted only for published
   * Posts and Articles. The repository validates this inside
   * its transaction.
   */
  public async setReaction(input: SetReactionInput): Promise<ReactionResult> {
    const { actorId, targetId, targetType, reactionType } = input;

    const isComment = this.isCommentTarget(targetType);

    const result = isComment
      ? await reactionRepository.setCommentReaction(
          targetId,
          actorId,
          reactionType,
        )
      : await reactionRepository.setContentItemReaction(
          targetId,
          actorId,
          reactionType,
        );

    if (!result) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Content not found");
    }

    const currentReactionType = result.reaction?.reactionType ?? null;

    // An identical reaction is idempotent: do not publish another event.
    if (result.previousReactionType === reactionType) {
      return {
        targetId,
        targetType,
        reactionType: currentReactionType,
        isReacted: true,
      };
    }

    const eventType: ReactionEventType =
      result.previousReactionType === null
        ? "reaction.added"
        : "reaction.changed";

    const event = interactionEventMapper.mapReactionEvent(eventType, {
      actorId,
      targetId,
      targetType,
      reactionType,
    });

    /*
     * Reaction persistence has already succeeded.
     * Event publishing is best-effort and must not turn a successful
     * reaction operation into a failed API response.
     */
    try {
      await interactionEventPublisher.publish(event);
    } catch (error: unknown) {
      logger.error(`Failed to publish ${eventType} event`, {
        actorId,
        targetId,
        targetType,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      targetId,
      targetType,
      reactionType: currentReactionType,
      isReacted: true,
    };
  }

  /**
   * Remove a user's reaction.
   *
   * Removing a reaction is idempotent. If no reaction exists,
   * no counter is changed and no event is published.
   */
  public async removeReaction(
    input: RemoveReactionInput,
  ): Promise<ReactionResult> {
    const { actorId, targetId, targetType } = input;

    const isComment = this.isCommentTarget(targetType);

    const deleted = isComment
      ? await reactionRepository.deleteCommentReaction(targetId, actorId)
      : await reactionRepository.deleteContentItemReaction(targetId, actorId);

    if (!deleted) {
      return {
        targetId,
        targetType,
        reactionType: null,
        isReacted: false,
      };
    }

    const event = interactionEventMapper.mapReactionEvent("reaction.removed", {
      actorId,
      targetId,
      targetType,
      reactionType: deleted.reactionType,
    });

    try {
      await interactionEventPublisher.publish(event);
    } catch (error: unknown) {
      logger.error("Failed to publish reaction.removed event", {
        actorId,
        targetId,
        targetType,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      targetId,
      targetType,
      reactionType: null,
      isReacted: false,
    };
  }

  // Generic content-item reactions

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
   * Persistence and counter updates are handled inside one
   * repository transaction.
   */
  public async toggleContentItemLike(
    actorId: string,
    contentItemId: string,
  ): Promise<ReactionResult> {
    const result = await reactionRepository.toggleContentItemLike(
      contentItemId,
      actorId,
    );

    if (!result) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Content not found");
    }

    const eventType: ReactionEventType =
      result.action === "added"
        ? "reaction.added"
        : result.action === "changed"
          ? "reaction.changed"
          : "reaction.removed";

    const event = interactionEventMapper.mapReactionEvent(eventType, {
      actorId,
      targetId: contentItemId,
      targetType: "CONTENT_ITEM",
      reactionType: "like",
    });

    try {
      await interactionEventPublisher.publish(event);
    } catch (error: unknown) {
      logger.error(`Failed to publish ${eventType} event`, {
        actorId,
        contentItemId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      targetId: contentItemId,
      targetType: "CONTENT_ITEM",
      reactionType: result.reactionType,
      isReacted: result.action !== "removed",
    };
  }
}

export const reactionService = new ReactionService();
