/**
 * Initial grouping policy for post reaction notifications.
 *
 * The five-minute window is calculated from the source event's
 * occurrence time, not the time at which a worker processes it.
 */
export const POST_REACTION_GROUPING_WINDOW_MS = 5 * 60 * 1000;

/**
 * Maximum number of distinct actors displayed in a grouped notification.
 *
 * The aggregate event count is maintained independently of this limit.
 */
export const GROUPED_NOTIFICATION_ACTOR_DISPLAY_LIMIT = 3;

export const POST_REACTION_ACTIVITY_TYPE = "post.reaction" as const;

interface PostReactionGroupingKeyInput {
  contentItemId: string;
  reactionType: string;
}

/**
 * Generate a deterministic key for reactions on one post.
 *
 * Recipient identity is stored separately in notification_groups.
 * The database uniqueness constraint combines it with this key
 * and the grouping-window start.
 */
export function createPostReactionGroupingKey(
  input: PostReactionGroupingKeyInput,
): string {
  return `post-reaction:${input.contentItemId}:${input.reactionType}`;
}

/**
 * Calculate the UTC-aligned five-minute bucket containing an event.
 *
 * Events in the same bucket receive the same grouping-window start,
 * regardless of which worker processes them.
 */
export function getPostReactionGroupingWindowStart(occurredAt: Date): Date {
  const timestamp = occurredAt.getTime();

  if (!Number.isFinite(timestamp)) {
    throw new Error("Invalid reaction event occurrence timestamp.");
  }

  const windowStart =
    Math.floor(timestamp / POST_REACTION_GROUPING_WINDOW_MS) *
    POST_REACTION_GROUPING_WINDOW_MS;

  return new Date(windowStart);
}
