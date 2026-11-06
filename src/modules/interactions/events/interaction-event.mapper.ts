import type {
  InteractionEventInput,
  InteractionEventTargetType,
  InteractionEventType,
} from "../contracts/interaction-event.types";

import type { ReactionType } from "../contracts/reaction.types";

/**
 * Reaction event input.
 *
 * CONTENT_ITEM represents both Posts and Articles.
 * POST remains temporarily supported for backward compatibility.
 * COMMENT uses the separate comment-reactions infrastructure.
 */
interface ReactionEventInput {
  actorId: string;
  targetId: string;
  targetType: "POST" | "CONTENT_ITEM" | "COMMENT";
  reactionType?: ReactionType;
}

/**
 * Shared identifier input for content-item events.
 *
 * New code should provide contentItemId.
 * postId remains available for existing callers during migration.
 */
type ContentItemTargetInput =
  | {
      contentItemId: string;
      postId?: never;
    }
  | {
      postId: string;
      contentItemId?: never;
    };

type SaveEventInput = {
  actorId: string;
} & ContentItemTargetInput;

type ShareEventInput = {
  actorId: string;
  platform: string;
} & ContentItemTargetInput;

interface FollowEventInput {
  actorId: string;
  targetUserId: string;
}

/**
 * Resolve the shared content identifier.
 *
 * Supports both the legacy postId property and the new
 * contentItemId property.
 */
function getContentItemId(input: ContentItemTargetInput): string {
  if (typeof input.contentItemId === "string") {
    return input.contentItemId;
  }

  if (typeof input.postId === "string") {
    return input.postId;
  }

  throw new Error("A contentItemId or postId is required");
}
export class InteractionEventMapper {
  /**
   * Map a reaction operation into a normalized interaction event.
   *
   * Both POST and CONTENT_ITEM are persisted as CONTENT_ITEM targets.
   * COMMENT remains a COMMENT target.
   */
  public mapReactionEvent(
    eventType: Extract<
      InteractionEventType,
      "reaction.added" | "reaction.changed" | "reaction.removed"
    >,
    input: ReactionEventInput,
  ): InteractionEventInput {
    const targetType: InteractionEventTargetType =
      input.targetType === "COMMENT" ? "COMMENT" : "CONTENT_ITEM";

    return {
      actorId: input.actorId,
      eventType,
      targetType,
      targetId: input.targetId,

      metadata: input.reactionType ? { reactionType: input.reactionType } : {},
    };
  }

  /**
   * Map a user follow operation into an interaction event.
   *
   * Follow events target users rather than content items.
   */
  public mapFollowEvent(
    eventType: Extract<
      InteractionEventType,
      "follow.created" | "follow.removed"
    >,
    input: FollowEventInput,
  ): InteractionEventInput {
    return {
      actorId: input.actorId,
      eventType,
      targetType: "USER",
      targetId: input.targetUserId,
      metadata: {},
    };
  }

  /**
   * Map a content-item save operation into an interaction event.
   *
   * Works for both Posts and Articles.
   */
  public mapSaveEvent(
    eventType: Extract<InteractionEventType, "save.created" | "save.removed">,
    input: SaveEventInput,
  ): InteractionEventInput {
    return {
      actorId: input.actorId,
      eventType,
      targetType: "CONTENT_ITEM",
      targetId: getContentItemId(input),
      metadata: {},
    };
  }

  /**
   * Map a content-item share operation into an interaction event.
   *
   * The platform name is included in event metadata for analytics
   * and downstream notification processing.
   */
  public mapShareEvent(input: ShareEventInput): InteractionEventInput {
    return {
      actorId: input.actorId,
      eventType: "share.created",
      targetType: "CONTENT_ITEM",
      targetId: getContentItemId(input),
      metadata: {
        platform: input.platform,
      },
    };
  }
}

export const interactionEventMapper = new InteractionEventMapper();
