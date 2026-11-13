import { z } from "zod";

import { reactionTypes } from "../../../db/schema/content-reactions";
import { DOMAIN_EVENT_NAMES } from "../domain/event-name";

/**
 * Runtime schema for the supported event-name vocabulary.
 *
 * This is useful when reading an event from PostgreSQL or a queue because
 * persisted data is not protected by TypeScript's compile-time checks.
 */
export const domainEventNameSchema = z.enum(DOMAIN_EVENT_NAMES);

/**
 * Shared UUID validation for event payload identifiers.
 *
 * These identifiers are validated at the application boundary even when
 * the payload is stored as JSONB and therefore has no relational FK.
 */
const uuidSchema = z.string().uuid();

/**
 * Reactions are valid for either a content item or a comment.
 *
 * The legacy POST target is normalised to CONTENT_ITEM by the existing
 * interaction event mapper before it reaches this event contract.
 */
export const reactionEventPayloadSchema = z.strictObject({
  targetType: z.enum(["CONTENT_ITEM", "COMMENT"]),
  targetId: uuidSchema,
  reactionType: z.enum(reactionTypes),
});

/**
 * A follow event targets the user who was followed or unfollowed.
 * The actor is carried at the event-envelope level.
 */
export const followEventPayloadSchema = z.strictObject({
  targetUserId: uuidSchema,
});

/**
 * Save events are associated with the shared content-item model.
 * This supports both Posts and Articles.
 */
export const saveEventPayloadSchema = z.strictObject({
  contentItemId: uuidSchema,
});

/**
 * A share event records the content item and the platform selected by
 * the user. The platform remains a bounded string because the existing
 * share contract accepts platform names as strings.
 */
export const shareEventPayloadSchema = z.strictObject({
  contentItemId: uuidSchema,
  platform: z.string().trim().min(1).max(50),
});

/**
 * A top-level comment was created on a published Post or Article.
 *
 * The actor is carried by the event envelope. These identifiers let the
 * consumer verify that the comment still exists and belongs to the content.
 */
export const commentCreatedEventPayloadSchema = z.strictObject({
  contentItemId: uuidSchema,
  commentId: uuidSchema,
});

/**
 * A user replied to an existing comment.
 *
 * The reply and its parent must belong to the same content item.
 */
export const commentRepliedEventPayloadSchema = z.strictObject({
  contentItemId: uuidSchema,
  commentId: uuidSchema,
  parentCommentId: uuidSchema,
});

/**
 * A user was newly mentioned in a published Post or Article.
 *
 * The content author is the event actor. The mentioned user is
 * the intended notification recipient.
 */
export const mentionCreatedEventPayloadSchema = z.strictObject({
  contentItemId: uuidSchema,
  mentionedUserId: uuidSchema,
});

export type MentionCreatedEventPayload = z.infer<
  typeof mentionCreatedEventPayloadSchema
>;

export type CommentRepliedEventPayload = z.infer<
  typeof commentRepliedEventPayloadSchema
>;

export type CommentCreatedEventPayload = z.infer<
  typeof commentCreatedEventPayloadSchema
>;

export type ReactionEventPayload = z.infer<typeof reactionEventPayloadSchema>;

export type FollowEventPayload = z.infer<typeof followEventPayloadSchema>;

export type SaveEventPayload = z.infer<typeof saveEventPayloadSchema>;

export type ShareEventPayload = z.infer<typeof shareEventPayloadSchema>;
