import { ZodError, z } from "zod";

import { db, type DatabaseTransaction } from "../../../db";

import type { OutboxEvent } from "../../../db/schema/outbox-events";
import type {
  NewNotification,
  Notification,
} from "../../../db/schema/notifications";

import { HTTP_STATUS } from "@shared/constants/http-codes";
import { AppError } from "@shared/utils/app.error";

import logger from "@config/logger";

import type { DomainEventName } from "../domain/event-name";
import { isDomainEventName } from "../domain/event-name";

import { NOTIFICATION_DELIVERY_REQUESTED_EVENT } from "../domain/delivery-event-name";

import {
  getInAppPreferencePolicyForEvent,
  getNotificationPolicy,
  NOTIFICATION_POLICY_VERSION,
} from "../domain/notification-policy.registry";

import {
  createPostReactionGroupingKey,
  getPostReactionGroupingWindowStart,
} from "../domain/notification-grouping.policy";

import {
  parseEventPayload,
  type EventPayloadMap,
} from "../events/event.registry";

import {
  notificationGroupRepository,
  type AddPostReactionToGroupInput,
} from "../repositories/notification-group.repository";

import { notificationDeliveryRepository } from "../repositories/notification-delivery.repository";
import { notificationPreferenceRepository } from "../repositories/notification-preference.repository";
import { notificationRepository } from "../repositories/notification.repository";
import { outboxRepository } from "../repositories/outbox.repository";

import {
  processedEventRepository,
  type TerminalProcessedEventOutcome,
} from "../repositories/processed-event.repository";

/**
 * Stable identity for this logical consumer.
 *
 * Keep this value unchanged across normal deployments. Changing it creates
 * a new idempotency namespace and allows the same events to be processed
 * again by this consumer.
 */
export const NOTIFICATION_INBOX_CONSUMER = "notification-inbox-processor";

export interface NotificationProcessResult {
  status: "PROCESSED" | "DUPLICATE";
  notificationCreated: boolean;
}

interface InboxNotificationInput {
  recipientUserId: string;
  actorUserId: string;
  notificationType: string;
  title: string;
  body: string;
  presentationData?: Record<string, unknown>;
  resourceType?: string;
  resourceId?: string;
  actionType?: string;
}

/**
 * Converts supported domain events into durable inbox notifications.
 *
 * Event-specific category and priority are resolved through the
 * notification policy registry instead of being hardcoded here.
 *
 * External channel delivery, such as email, browser push and real-time
 * updates, is handled by separate delivery components.
 */
export class NotificationProcessorService {
  /**
   * Process one event identified by its durable outbox ID.
   *
   * These operations commit or roll back together:
   * 1. Reserve the event in processed_events.
   * 2. Load and validate the outbox event.
   * 3. Resolve the notification recipient.
   * 4. Insert or update the inbox notification, when appropriate.
   * 5. Create the corresponding channel delivery record.
   * 6. Create the delivery-request outbox event.
   * 7. Record the terminal processing outcome.
   *
   * If processing fails, the transaction rolls back. BullMQ can then retry
   * the job without losing the opportunity to process the event.
   */
  public async process(eventId: string): Promise<NotificationProcessResult> {
    const eventIdResult = z.string().uuid().safeParse(eventId);

    if (!eventIdResult.success) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "A valid outbox event ID is required.",
      );
    }

    return db.transaction(async (transaction) => {
      // Reserve the event first. The composite primary key prevents
      // simultaneous delivery of the same event to this consumer.
      const isFirstProcessingAttempt =
        await processedEventRepository.tryMarkProcessed(
          transaction,
          NOTIFICATION_INBOX_CONSUMER,
          eventId,
        );

      if (!isFirstProcessingAttempt) {
        logger.debug("Notification event already processed", {
          eventId,
          consumer: NOTIFICATION_INBOX_CONSUMER,
        });

        return {
          status: "DUPLICATE",
          notificationCreated: false,
        };
      }

      const event = await outboxRepository.findById(transaction, eventId);

      if (!event) {
        // Throwing rolls back the processed-event reservation.
        throw new AppError(
          HTTP_STATUS.NOT_FOUND,
          `Outbox event "${eventId}" was not found.`,
        );
      }

      /**
       * Do not gate consumer processing on the outbox status.
       *
       * The dispatcher uses that status to track queue handoff. A queue
       * consumer may start before the dispatcher records PUBLISHED.
       *
       * Consumer idempotency is controlled by processed_events instead.
       */

      if (!isDomainEventName(event.eventName)) {
        throw new AppError(
          HTTP_STATUS.UNPROCESSABLE_ENTITY,
          `Unsupported notification event name "${event.eventName}".`,
        );
      }

      const notification = await this.buildNotification(transaction, event);

      let outcome: TerminalProcessedEventOutcome;
      let notificationCreated = false;

      // Retain the persisted notification so its delivery can be created
      // within this same transaction.
      let notificationForDelivery: Notification | null = null;
      let notificationGroupId: string | null = null;

      if (notification) {
        const isInAppEnabled = await this.isInAppDeliveryEnabled(
          transaction,
          event.eventName,
          notification.recipientUserId,
        );

        if (!isInAppEnabled) {
          // No inbox notification or realtime delivery is created.
          outcome = "no_delivery_required";
        } else {
          const groupingInput = await this.buildPostReactionGroupingInput(
            transaction,
            event,
            notification,
          );

          if (groupingInput) {
            const groupedResult =
              await notificationGroupRepository.addPostReactionToGroup(
                transaction,
                groupingInput,
              );

            if (groupedResult.outcome === "created") {
              outcome = "notification_created";
              notificationCreated = true;
            } else if (groupedResult.outcome === "updated") {
              outcome = "group_updated";
            } else {
              // A duplicate group membership must not create another delivery.
              outcome = "no_delivery_required";
            }

            /*
             * Both newly created and updated groups need a realtime update.
             * A duplicate membership must not generate another delivery.
             */
            if (groupedResult.outcome !== "duplicate") {
              notificationForDelivery = groupedResult.notification;
              notificationGroupId = groupedResult.groupId;
            }
          } else {
            notificationForDelivery = await notificationRepository.create(
              transaction,
              notification,
            );

            outcome = "notification_created";
            notificationCreated = true;
          }
        }
      } else {
        outcome = "no_delivery_required";
      }

      /*
       * Create the realtime delivery only when an eligible inbox notification
       * was actually created or updated.
       *
       * The delivery row and its outbox request are part of the same transaction
       * as the notification and processed-event outcome.
       */
      if (notificationForDelivery) {
        const delivery = await notificationDeliveryRepository.create(
          transaction,
          {
            notificationId: notificationForDelivery.id,
            groupId: notificationGroupId,
            recipientUserId: notificationForDelivery.recipientUserId,
            sourceEventId: event.id,

            channel: "realtime",

            // Each source event gets one logical delivery per notification.
            idempotencyKey: `realtime:${event.id}:${notificationForDelivery.id}`,

            policyVersion: NOTIFICATION_POLICY_VERSION,
            eligibilityDecision: "eligible",
            reasonCode: "in_app_preference_enabled",
            preferenceEvaluatedAt: new Date(),
          },
        );

        // The worker receives only the delivery ID and reloads durable data.
        await outboxRepository.create(transaction, {
          eventName: NOTIFICATION_DELIVERY_REQUESTED_EVENT,
          eventVersion: 1,
          producer: "notification-processor",

          aggregateType: "notification_delivery",
          aggregateId: delivery.id,

          actorId: event.actorId,

          payload: {
            deliveryId: delivery.id,
          },

          metadata: {
            sourceEventId: event.id,
            notificationId: notificationForDelivery.id,
            channel: "realtime",
          },

          correlationId: event.correlationId,
          causationId: event.id,
          occurredAt: event.occurredAt,
        });
      }

      // The notification, delivery, outbox request and terminal outcome
      // must all commit or roll back together.
      await processedEventRepository.setOutcome(
        transaction,
        NOTIFICATION_INBOX_CONSUMER,
        eventId,
        outcome,
      );

      logger.info("Notification event processed", {
        eventId,
        eventName: event.eventName,
        outcome,
        notificationCreated,
      });

      return {
        status: "PROCESSED",
        notificationCreated,
      };
    });
  }

  /**
   * Parse a registered event payload.
   *
   * A schema mismatch is a permanent data/contract problem, not a transient
   * infrastructure failure. Convert ZodError to AppError so the worker can
   * classify it correctly.
   */
  private parsePayload<TName extends DomainEventName>(
    eventName: TName,
    eventVersion: number,
    payload: unknown,
  ): EventPayloadMap[TName] {
    try {
      return parseEventPayload(eventName, eventVersion, payload);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      if (error instanceof ZodError) {
        const invalidFields = error.issues
          .map((issue) => issue.path.join(".") || "(payload)")
          .join(", ");

        throw new AppError(
          HTTP_STATUS.UNPROCESSABLE_ENTITY,
          `Invalid payload for event "${eventName}". ` +
            `Invalid fields: ${invalidFields}.`,
        );
      }

      // Preserve database, connection and unexpected errors so the worker
      // can distinguish them from permanent payload/contract failures.
      throw error;
    }
  }

  /**
   * Resolve whether an event is eligible for in-app delivery.
   *
   * Policy defaults are used when no user override exists.
   * Non-editable preferences always follow the central policy.
   *
   * Preference changes apply prospectively: existing inbox notifications
   * are not deleted or modified when a preference is disabled.
   */
  private async isInAppDeliveryEnabled(
    transaction: DatabaseTransaction,
    eventName: DomainEventName,
    recipientUserId: string,
  ): Promise<boolean> {
    const preferencePolicy = getInAppPreferencePolicyForEvent(eventName);

    // Events without an available in-app channel cannot create inbox items.
    if (!preferencePolicy) {
      return false;
    }

    // Only editable preferences can have user-specific overrides.
    const override = preferencePolicy.editable
      ? await notificationPreferenceRepository.findInAppOverride(
          transaction,
          recipientUserId,
          preferencePolicy.category,
        )
      : null;

    return override ?? preferencePolicy.enabledByDefault;
  }

  /**
   * Resolve whether a notification belongs to the Post reaction grouping
   * policy. All other notification types retain individual inbox records.
   *
   * The actual content subtype is resolved from content_items because
   * both Posts and Articles use the CONTENT_ITEM event target.
   */
  private async buildPostReactionGroupingInput(
    transaction: DatabaseTransaction,
    event: OutboxEvent,
    notification: NewNotification,
  ): Promise<AddPostReactionToGroupInput | null> {
    if (event.eventName !== "reaction.added") {
      return null;
    }

    const payload = this.parsePayload(
      "reaction.added",
      event.eventVersion,
      event.payload,
    );

    // Comment reactions and other target types remain individual.
    if (payload.targetType !== "CONTENT_ITEM") {
      return null;
    }

    const contentItem = await notificationRepository.findContentItemDetails(
      transaction,
      payload.targetId,
    );

    // Only Post reactions are grouped. Article reactions remain individual.
    if (!contentItem || contentItem.contentType !== "post") {
      return null;
    }

    if (!event.actorId) {
      return null;
    }

    return {
      recipientUserId: notification.recipientUserId,
      actorUserId: event.actorId,
      sourceEventId: event.id,
      occurredAt: event.occurredAt,

      groupingKey: createPostReactionGroupingKey({
        contentItemId: payload.targetId,
        reactionType: payload.reactionType,
      }),

      groupingWindowStart: getPostReactionGroupingWindowStart(event.occurredAt),

      notification,
    };
  }

  /**
   * Translate a registered domain event into an inbox notification.
   *
   * Valid events that do not require an inbox notification are processed
   * successfully and receive a no_delivery_required outcome.
   */
  private async buildNotification(
    transaction: DatabaseTransaction,
    event: OutboxEvent,
  ): Promise<NewNotification | null> {
    if (!isDomainEventName(event.eventName)) {
      throw new AppError(
        HTTP_STATUS.UNPROCESSABLE_ENTITY,
        `Unsupported notification event name "${event.eventName}".`,
      );
    }

    switch (event.eventName) {
      case "reaction.added": {
        const payload = this.parsePayload(
          "reaction.added",
          event.eventVersion,
          event.payload,
        );

        if (!event.actorId) {
          // The actor may have been deleted after the event was produced.
          return null;
        }

        /**
         * Check that the reaction still exists with the same type.
         *
         * The repository locks the current reaction row. This prevents
         * a stale reaction.added event from creating a notification after
         * the actor has already changed or removed that reaction.
         */
        const isCurrentReaction =
          payload.targetType === "COMMENT"
            ? await notificationRepository.hasMatchingCommentReaction(
                transaction,
                payload.targetId,
                event.actorId,
                payload.reactionType,
              )
            : await notificationRepository.hasMatchingContentItemReaction(
                transaction,
                payload.targetId,
                event.actorId,
                payload.reactionType,
              );

        if (!isCurrentReaction) {
          return null;
        }

        const recipientId =
          payload.targetType === "COMMENT"
            ? await notificationRepository.findCommentAuthorId(
                transaction,
                payload.targetId,
              )
            : await notificationRepository.findContentItemAuthorId(
                transaction,
                payload.targetId,
              );

        if (!recipientId || recipientId === event.actorId) {
          return null;
        }

        const targetDescription =
          payload.targetType === "COMMENT" ? "comment" : "content";

        const title =
          payload.targetType === "COMMENT"
            ? "New reaction on your comment"
            : "New reaction on your content";

        const body = `reacted to your ${targetDescription}.`;

        return this.createInboxNotification(event, {
          recipientUserId: recipientId,
          actorUserId: event.actorId,
          notificationType: "REACTION",
          title,
          body,
          presentationData: {
            reactionType: payload.reactionType,
            targetType: payload.targetType,
          },
          resourceType:
            payload.targetType === "COMMENT" ? "comment" : "content_item",
          resourceId: payload.targetId,
          actionType: "open_resource",
        });
      }

      case "reaction.changed": {
        this.parsePayload(
          "reaction.changed",
          event.eventVersion,
          event.payload,
        );

        // Changing an existing reaction does not create another inbox item.
        return null;
      }

      case "reaction.removed": {
        this.parsePayload(
          "reaction.removed",
          event.eventVersion,
          event.payload,
        );

        return null;
      }

      case "follow.created": {
        const payload = this.parsePayload(
          "follow.created",
          event.eventVersion,
          event.payload,
        );

        if (!event.actorId || event.actorId === payload.targetUserId) {
          return null;
        }

        /*
         * The follow may have been removed before its outbox event
         * reached the notification processor.
         *
         * Only notify when the original relationship still exists.
         */
        const isCurrentFollow =
          await notificationRepository.hasFollowRelationship(
            transaction,
            event.actorId,
            payload.targetUserId,
          );

        if (!isCurrentFollow) {
          return null;
        }

        return this.createInboxNotification(event, {
          recipientUserId: payload.targetUserId,
          actorUserId: event.actorId,
          notificationType: "FOLLOW",
          title: "New follower",
          body: "started following you.",
          presentationData: {},
          resourceType: "user",
          resourceId: event.actorId,
          actionType: "open_resource",
        });
      }

      case "follow.removed": {
        this.parsePayload("follow.removed", event.eventVersion, event.payload);

        return null;
      }

      case "save.created": {
        this.parsePayload("save.created", event.eventVersion, event.payload);

        // Saves are private user actions; they do not notify the author.
        return null;
      }

      case "save.removed": {
        this.parsePayload("save.removed", event.eventVersion, event.payload);

        return null;
      }

      case "share.created": {
        this.parsePayload("share.created", event.eventVersion, event.payload);

        // External platform shares are tracked, but do not generate notifications.
        return null;
      }

      case "comment.created": {
        const payload = this.parsePayload(
          "comment.created",
          event.eventVersion,
          event.payload,
        );

        if (!event.actorId) {
          return null;
        }

        const commentContext =
          await notificationRepository.findCommentCreatedNotificationContext(
            transaction,
            payload.commentId,
            payload.contentItemId,
          );

        // Ignore deleted, mismatched, non-top-level, or unpublished content.
        if (
          !commentContext ||
          commentContext.commentAuthorId !== event.actorId ||
          commentContext.parentCommentId !== null ||
          commentContext.contentStatus !== "published"
        ) {
          return null;
        }

        // Authors do not receive notifications for their own comments.
        if (commentContext.recipientUserId === event.actorId) {
          return null;
        }

        return this.createInboxNotification(event, {
          recipientUserId: commentContext.recipientUserId,
          actorUserId: event.actorId,
          notificationType: "COMMENT",
          title: "New comment",
          body: "commented on your content.",
          presentationData: {
            contentItemId: payload.contentItemId,
          },
          resourceType: "comment",
          resourceId: payload.commentId,
          actionType: "open_resource",
        });
      }

      case "comment.replied": {
        const payload = this.parsePayload(
          "comment.replied",
          event.eventVersion,
          event.payload,
        );

        if (!event.actorId) {
          return null;
        }

        const replyContext =
          await notificationRepository.findCommentRepliedNotificationContext(
            transaction,
            payload.commentId,
            payload.parentCommentId,
            payload.contentItemId,
          );

        // Ignore deleted, mismatched, or unpublished reply context.
        if (
          !replyContext ||
          replyContext.replyAuthorId !== event.actorId ||
          replyContext.replyParentCommentId !== payload.parentCommentId ||
          replyContext.contentStatus !== "published"
        ) {
          return null;
        }

        // Do not notify someone about their own reply.
        if (replyContext.recipientUserId === event.actorId) {
          return null;
        }

        return this.createInboxNotification(event, {
          recipientUserId: replyContext.recipientUserId,
          actorUserId: event.actorId,
          notificationType: "COMMENT",
          title: "New reply",
          body: "replied to your comment.",
          presentationData: {
            contentItemId: payload.contentItemId,
            parentCommentId: payload.parentCommentId,
          },
          resourceType: "comment",
          resourceId: payload.commentId,
          actionType: "open_resource",
        });
      }

      case "mention.created": {
        const payload = this.parsePayload(
          "mention.created",
          event.eventVersion,
          event.payload,
        );

        if (!event.actorId) {
          return null;
        }

        const mentionContext =
          await notificationRepository.findMentionCreatedNotificationContext(
            transaction,
            payload.contentItemId,
            payload.mentionedUserId,
          );

        // Ignore removed mentions, mismatched authors, or unpublished content.
        if (
          !mentionContext ||
          mentionContext.contentAuthorId !== event.actorId ||
          mentionContext.recipientUserId !== payload.mentionedUserId ||
          mentionContext.contentStatus !== "published"
        ) {
          return null;
        }

        // Authors do not receive notifications for mentioning themselves.
        if (mentionContext.recipientUserId === event.actorId) {
          return null;
        }

        return this.createInboxNotification(event, {
          recipientUserId: mentionContext.recipientUserId,
          actorUserId: event.actorId,
          notificationType: "MENTION",
          title: "You were mentioned",
          body: "mentioned you in their content.",
          presentationData: {
            contentItemId: payload.contentItemId,
          },
          resourceType: "content_item",
          resourceId: payload.contentItemId,
          actionType: "open_resource",
        });
      }

      default: {
        // Compile-time guard: adding an event name without adding its
        // handler here will produce a TypeScript error.
        const exhaustiveCheck: never = event.eventName;

        throw new AppError(
          HTTP_STATUS.UNPROCESSABLE_ENTITY,
          `No notification handler exists for event "${String(exhaustiveCheck)}".`,
        );
      }
    }
  }

  /**
   * Build a new inbox row with common event-tracing and idempotency fields.
   *
   * The source event ID is retained instead of copying the entire event
   * payload into the notification record.
   */
  private createInboxNotification(
    event: OutboxEvent,
    input: InboxNotificationInput,
  ): NewNotification {
    if (!isDomainEventName(event.eventName)) {
      throw new AppError(
        HTTP_STATUS.UNPROCESSABLE_ENTITY,
        `Unsupported notification event name "${event.eventName}".`,
      );
    }

    // Resolve category and priority from the central event policy registry.
    const policy = getNotificationPolicy(event.eventName);

    if (!policy) {
      throw new AppError(
        HTTP_STATUS.UNPROCESSABLE_ENTITY,
        `No notification policy is registered for event "${event.eventName}".`,
      );
    }

    return {
      recipientUserId: input.recipientUserId,
      actorUserId: input.actorUserId,

      sourceEventId: event.id,

      notificationType: input.notificationType,
      category: policy.category,
      priority: policy.priority,

      title: input.title,
      body: input.body,

      presentationData: input.presentationData ?? {},

      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      actionType: input.actionType ?? null,

      // One event can create at most one logical notification per recipient.
      dedupeKey: `event:${event.id}:${input.notificationType}`,

      status: "active",

      // Preserve event occurrence time for chronological inbox ordering.
      createdAt: event.occurredAt,
      updatedAt: event.occurredAt,
    };
  }
}

export const notificationProcessorService = new NotificationProcessorService();
