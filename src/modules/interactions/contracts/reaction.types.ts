import type { ReactionType } from "../../../db/schema/content-reactions";

export type { ReactionType };

/**
 * Identifies the resource receiving a reaction.
 *
 * CONTENT_ITEM represents either:
 * - A short Post.
 * - A long-form Article.
 *
 * COMMENT represents a comment reaction, which is persisted
 * separately in comment_reactions.
 *
 * POST is retained temporarily for backward compatibility with
 * existing callers. New code should use CONTENT_ITEM.
 */
export type ReactionTargetType = "CONTENT_ITEM" | "COMMENT" | "POST";

/**
 * Input required to create or change a reaction.
 */
export interface SetReactionInput {
  actorId: string;
  targetId: string;
  targetType: ReactionTargetType;
  reactionType: ReactionType;
}

/**
 * Input required to remove an existing reaction.
 */
export interface RemoveReactionInput {
  actorId: string;
  targetId: string;
  targetType: ReactionTargetType;
}

/**
 * Result returned after setting or removing a reaction.
 */
export interface ReactionResult {
  targetId: string;
  targetType: ReactionTargetType;
  reactionType: ReactionType | null;
  isReacted: boolean;
}

/**
 * Aggregated reaction statistics.
 *
 * `total` represents the number of current reactions.
 * `byType` contains the count for each supported reaction type.
 */
export interface ReactionCount {
  total: number;
  byType: Record<ReactionType, number>;
}
