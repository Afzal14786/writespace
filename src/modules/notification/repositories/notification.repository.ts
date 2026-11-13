import {
  and,
  desc,
  eq,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  asc,
  inArray,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type DatabaseTransaction } from "../../../db";

import { HTTP_STATUS } from "@shared/constants/http-codes";
import { AppError } from "@shared/utils/app.error";

import {
  users,
  follows,
  comments,
  contentItems,
  commentReactions,
  contentReactions,
  contentMentions,
  notificationGroups,
} from "../../../db/schema";

import type { ReactionType } from "../../../db/schema/content-reactions";
import {
  notifications,
  type NewNotification,
  type Notification,
  type NotificationStatus,
} from "../../../db/schema/notifications";

export interface NotificationInboxCursor {
  createdAt: string;
  id: string;
}

export interface NotificationInboxListOptions {
  recipientId: string;
  limit: number;
  cursor?: NotificationInboxCursor;
  view?: NotificationStatus;
  unread?: boolean;
  type?: string;
  category?: string;
}

export interface NotificationLifecycleRecord {
  id: string;
  status: NotificationStatus;
  readAt: Date | null;
  deletedAt: Date | null;
  updatedAt: Date;
}

export type NotificationLifecycleMutationResult =
  | {
      outcome: "updated" | "unchanged" | "already_deleted";
      notification: NotificationLifecycleRecord;
    }
  | {
      outcome: "not_found";
    }
  | {
      outcome: "invalid_state";
      currentStatus: NotificationStatus;
    };

/**
 * Database operations related to the notification inbox.
 *
 * All methods that participate in event processing accept the caller's
 * transaction so notification creation and event idempotency can be atomic.
 */
export class NotificationRepository {
  /**
   * Lock a notification before applying a lifecycle transition.
   *
   * The recipient condition enforces ownership, while FOR UPDATE
   * serializes concurrent dismiss, restore and delete requests.
   *
   * Deleted records are intentionally included here so that delete
   * can remain idempotent for the original owner.
   */
  private async lockLifecycleRecord(
    transaction: DatabaseTransaction,
    recipientId: string,
    notificationId: string,
  ) {
    const [notification] = await transaction
      .select({
        id: notifications.id,
        status: notifications.status,
        readAt: notifications.readAt,
        deletedAt: notifications.deletedAt,
        updatedAt: notifications.updatedAt,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.recipientUserId, recipientId),
        ),
      )
      .for("update")
      .limit(1);

    return notification ?? null;
  }

  /**
   * Check whether the actor's current content-item reaction still matches
   * the reaction.added event being processed.
   *
   * Lock the parent content item before the reaction row. This matches
   * the lock order used by ReactionRepository and prevents processing
   * notifications for content that is no longer published.
   */
  public async hasMatchingContentItemReaction(
    transaction: DatabaseTransaction,
    contentItemId: string,
    actorId: string,
    reactionType: ReactionType,
  ): Promise<boolean> {
    const [contentItem] = await transaction
      .select({
        id: contentItems.id,
        status: contentItems.status,
      })
      .from(contentItems)
      .where(eq(contentItems.id, contentItemId))
      .for("update")
      .limit(1);

    if (!contentItem || contentItem.status !== "published") {
      return false;
    }

    const [reaction] = await transaction
      .select({
        userId: contentReactions.userId,
      })
      .from(contentReactions)
      .where(
        and(
          eq(contentReactions.contentItemId, contentItemId),
          eq(contentReactions.userId, actorId),
          eq(contentReactions.reactionType, reactionType),
        ),
      )
      .for("update")
      .limit(1);

    return Boolean(reaction);
  }

  /**
   * Check whether the actor's current comment reaction still matches
   * the reaction.added event being processed.
   */
  public async hasMatchingCommentReaction(
    transaction: DatabaseTransaction,
    commentId: string,
    actorId: string,
    reactionType: ReactionType,
  ): Promise<boolean> {
    const [reaction] = await transaction
      .select({
        userId: commentReactions.userId,
      })
      .from(commentReactions)
      .where(
        and(
          eq(commentReactions.commentId, commentId),
          eq(commentReactions.userId, actorId),
          eq(commentReactions.reactionType, reactionType),
        ),
      )
      .for("update")
      .limit(1);

    return Boolean(reaction);
  }

  /**
   * Resolve the author of a shared content item.
   *
   * Posts and Articles use content_items as their common identity.
   */
  public async findContentItemAuthorId(
    transaction: DatabaseTransaction,
    contentItemId: string,
  ): Promise<string | null> {
    const [item] = await transaction
      .select({
        authorId: contentItems.authorId,
      })
      .from(contentItems)
      .where(eq(contentItems.id, contentItemId))
      .limit(1);

    return item?.authorId ?? null;
  }

  /**
   * Resolve the author and subtype of a content item.
   *
   * Posts and Articles share content_items, but their notification
   * grouping policies are different. The processor uses this result
   * to group Post reactions without grouping Article reactions.
   */
  public async findContentItemDetails(
    transaction: DatabaseTransaction,
    contentItemId: string,
  ) {
    const [item] = await transaction
      .select({
        authorId: contentItems.authorId,
        contentType: contentItems.contentType,
      })
      .from(contentItems)
      .where(eq(contentItems.id, contentItemId))
      .limit(1);

    return item ?? null;
  }

  /**
   * Resolve the author of a comment only when its parent content
   * is still published.
   *
   * A reaction notification must not be generated for a comment
   * whose Post or Article has become unpublished.
   */
  public async findCommentAuthorId(
    transaction: DatabaseTransaction,
    commentId: string,
  ): Promise<string | null> {
    const [comment] = await transaction
      .select({
        authorId: comments.authorId,
      })
      .from(comments)
      .innerJoin(contentItems, eq(comments.contentItemId, contentItems.id))
      .where(
        and(eq(comments.id, commentId), eq(contentItems.status, "published")),
      )
      .limit(1);

    return comment?.authorId ?? null;
  }

  /**
   * Resolve the context required for a top-level comment notification.
   *
   * The join verifies that the comment belongs to the event's content item.
   * The processor additionally checks the actor, parent relationship,
   * and published lifecycle status before creating an inbox notification.
   */
  public async findCommentCreatedNotificationContext(
    transaction: DatabaseTransaction,
    commentId: string,
    contentItemId: string,
  ) {
    const [context] = await transaction
      .select({
        commentAuthorId: comments.authorId,
        parentCommentId: comments.parentCommentId,
        recipientUserId: contentItems.authorId,
        contentStatus: contentItems.status,
      })
      .from(comments)
      .innerJoin(contentItems, eq(comments.contentItemId, contentItems.id))
      .where(
        and(
          eq(comments.id, commentId),
          eq(comments.contentItemId, contentItemId),
        ),
      )
      .limit(1);

    return context ?? null;
  }

  /**
   * Resolve the notification context for a reply.
   *
   * The immediate parent comment's author is the recipient.
   * Both comments must belong to the same content item, and the reply
   * must still reference the parent recorded in the domain event.
   */
  public async findCommentRepliedNotificationContext(
    transaction: DatabaseTransaction,
    replyCommentId: string,
    parentCommentId: string,
    contentItemId: string,
  ) {
    const parentComments = alias(comments, "parent_comments");

    const [context] = await transaction
      .select({
        replyAuthorId: comments.authorId,
        replyParentCommentId: comments.parentCommentId,
        recipientUserId: parentComments.authorId,
        contentStatus: contentItems.status,
      })
      .from(comments)
      .innerJoin(
        parentComments,
        eq(comments.parentCommentId, parentComments.id),
      )
      .innerJoin(contentItems, eq(comments.contentItemId, contentItems.id))
      .where(
        and(
          eq(comments.id, replyCommentId),
          eq(comments.parentCommentId, parentCommentId),
          eq(comments.contentItemId, contentItemId),
          eq(parentComments.contentItemId, contentItemId),
        ),
      )
      .limit(1);

    return context ?? null;
  }

  /**
   * Resolve the notification context for a content mention.
   *
   * The mention lookup row must still exist, and the content author's
   * identity and publication status are returned for event validation.
   * This prevents stale mention events from notifying users after a
   * mention has been removed or content is no longer published.
   */
  public async findMentionCreatedNotificationContext(
    transaction: DatabaseTransaction,
    contentItemId: string,
    mentionedUserId: string,
  ) {
    const [context] = await transaction
      .select({
        contentAuthorId: contentItems.authorId,
        recipientUserId: contentMentions.mentionedUserId,
        contentStatus: contentItems.status,
      })
      .from(contentMentions)
      .innerJoin(
        contentItems,
        eq(contentMentions.contentItemId, contentItems.id),
      )
      .where(
        and(
          eq(contentMentions.contentItemId, contentItemId),
          eq(contentMentions.mentionedUserId, mentionedUserId),
        ),
      )
      .limit(1);

    return context ?? null;
  }

  /**
   * Check whether a recipient still exists.
   *
   * Events can outlive the account that originally appeared in the event
   * payload. A deleted recipient is treated as a no-op by the processor.
   */
  public async findExistingUserId(
    transaction: DatabaseTransaction,
    userId: string,
  ): Promise<string | null> {
    const [user] = await transaction
      .select({
        id: users.id,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return user?.id ?? null;
  }

  /**
   * Verify that the original follow relationship still exists.
   *
   * Follow operations lock both user rows in ascending ID order.
   * Reusing that order here ensures notification processing coordinates
   * correctly with concurrent follow and unfollow operations.
   */
  public async hasFollowRelationship(
    transaction: DatabaseTransaction,
    followerId: string,
    followingId: string,
  ): Promise<boolean> {
    // Match the locking order used by FollowRepository.
    await transaction
      .select({
        id: users.id,
      })
      .from(users)
      .where(inArray(users.id, [followerId, followingId]))
      .orderBy(asc(users.id))
      .for("update");

    const [follow] = await transaction
      .select({
        followerId: follows.followerId,
        followingId: follows.followingId,
      })
      .from(follows)
      .where(
        and(
          eq(follows.followerId, followerId),
          eq(follows.followingId, followingId),
        ),
      )
      .for("update")
      .limit(1);

    return Boolean(follow);
  }

  /**
   * Retrieve a recipient's inbox using stable cursor-based pagination.
   *
   * Ordering is created_at DESC, id DESC. The cursor timestamp retains
   * PostgreSQL microsecond precision so that records sharing a timestamp
   * are not skipped between pages.
   */
  public async listInbox(options: NotificationInboxListOptions) {
    const cursorCondition = options.cursor
      ? or(
          sql`${notifications.createdAt} < ${options.cursor.createdAt}::timestamptz`,
          and(
            sql`${notifications.createdAt} = ${options.cursor.createdAt}::timestamptz`,
            lt(notifications.id, options.cursor.id),
          ),
        )
      : undefined;

    const view = options.view ?? "active";

    const unreadCondition =
      options.unread === undefined
        ? undefined
        : options.unread
          ? isNull(notifications.readAt)
          : isNotNull(notifications.readAt);

    return db
      .select({
        id: notifications.id,
        notificationType: notifications.notificationType,
        category: notifications.category,
        priority: notifications.priority,
        title: notifications.title,
        body: notifications.body,
        presentationData: notifications.presentationData,
        resourceType: notifications.resourceType,
        resourceId: notifications.resourceId,
        actionType: notifications.actionType,
        groupId: notifications.groupId,
        status: notifications.status,
        readAt: notifications.readAt,
        expiresAt: notifications.expiresAt,
        createdAt: notifications.createdAt,

        actorId: users.id,
        actorUsername: users.username,
        actorFullname: users.fullname,
        actorProfileImageUrl: users.profileImageUrl,

        groupCount: notificationGroups.groupCount,
        groupLastActivityAt: notificationGroups.lastActivityAt,

        // Internal cursor value; do not expose it as a separate API field.
        cursorCreatedAt: sql<string>`
          to_char(
            ${notifications.createdAt} AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          )
        `,
      })
      .from(notifications)
      .leftJoin(users, eq(notifications.actorUserId, users.id))
      .leftJoin(
        notificationGroups,
        eq(notifications.groupId, notificationGroups.id),
      )
      .where(
        and(
          eq(notifications.recipientUserId, options.recipientId),
          eq(notifications.status, view),
          isNull(notifications.deletedAt),
          cursorCondition,
          unreadCondition,
          options.type
            ? eq(notifications.notificationType, options.type)
            : undefined,
          options.category
            ? eq(notifications.category, options.category)
            : undefined,
        ),
      )
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(options.limit);
  }

  /**
   * Retrieve one notification belonging to the specified recipient.
   *
   * Ownership and soft-deletion checks are enforced in the query.
   * A notification belonging to another user is indistinguishable
   * from a missing notification.
   */
  public async findForRecipient(recipientId: string, notificationId: string) {
    const [notification] = await db
      .select({
        id: notifications.id,
        notificationType: notifications.notificationType,
        category: notifications.category,
        priority: notifications.priority,
        title: notifications.title,
        body: notifications.body,
        presentationData: notifications.presentationData,
        resourceType: notifications.resourceType,
        resourceId: notifications.resourceId,
        actionType: notifications.actionType,
        groupId: notifications.groupId,
        status: notifications.status,
        readAt: notifications.readAt,
        expiresAt: notifications.expiresAt,
        createdAt: notifications.createdAt,
        updatedAt: notifications.updatedAt,

        actorId: users.id,
        actorUsername: users.username,
        actorFullname: users.fullname,
        actorProfileImageUrl: users.profileImageUrl,

        groupCount: notificationGroups.groupCount,
        groupLastActivityAt: notificationGroups.lastActivityAt,
      })
      .from(notifications)
      .leftJoin(users, eq(notifications.actorUserId, users.id))
      .leftJoin(
        notificationGroups,
        eq(notifications.groupId, notificationGroups.id),
      )
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.recipientUserId, recipientId),
          isNull(notifications.deletedAt),
        ),
      )
      .limit(1);

    return notification ?? null;
  }

  /**
   * Mark one notification as read.
   *
   * Repeated requests do not overwrite the original read timestamp.
   * The recipient condition ensures that another user's notification
   * cannot be modified.
   */
  public async markAsReadForRecipient(
    recipientId: string,
    notificationId: string,
  ) {
    await db
      .update(notifications)
      .set({
        readAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.recipientUserId, recipientId),
          isNull(notifications.readAt),
          isNull(notifications.deletedAt),
        ),
      );

    return this.findForRecipient(recipientId, notificationId);
  }

  /**
   * Mark all active unread notifications belonging to a recipient as read.
   *
   * The number returned represents records actually changed.
   */
  public async markAllAsReadForRecipient(recipientId: string): Promise<number> {
    const now = new Date();

    const updated = await db
      .update(notifications)
      .set({
        readAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(notifications.recipientUserId, recipientId),
          eq(notifications.status, "active"),
          isNull(notifications.readAt),
          isNull(notifications.deletedAt),
        ),
      )
      .returning({
        id: notifications.id,
      });

    return updated.length;
  }

  /**
   * Dismiss an active notification from the recipient's inbox.
   *
   * Repeated dismissal is a successful no-op. Archived notifications
   * are not transitioned through this operation.
   */
  public async dismissForRecipient(
    recipientId: string,
    notificationId: string,
  ): Promise<NotificationLifecycleMutationResult> {
    return db.transaction(async (transaction) => {
      const current = await this.lockLifecycleRecord(
        transaction,
        recipientId,
        notificationId,
      );

      if (!current || current.deletedAt) {
        return { outcome: "not_found" };
      }

      if (current.status === "dismissed") {
        return {
          outcome: "unchanged",
          notification: current,
        };
      }

      if (current.status !== "active") {
        return {
          outcome: "invalid_state",
          currentStatus: current.status,
        };
      }

      const now = new Date();

      const [updated] = await transaction
        .update(notifications)
        .set({
          status: "dismissed",
          updatedAt: now,
        })
        .where(
          and(
            eq(notifications.id, notificationId),
            eq(notifications.recipientUserId, recipientId),
            eq(notifications.status, "active"),
            isNull(notifications.deletedAt),
          ),
        )
        .returning({
          id: notifications.id,
          status: notifications.status,
          readAt: notifications.readAt,
          deletedAt: notifications.deletedAt,
          updatedAt: notifications.updatedAt,
        });

      if (!updated) {
        throw new AppError(
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          "Failed to dismiss notification.",
        );
      }

      return {
        outcome: "updated",
        notification: updated,
      };
    });
  }

  /**
   * Restore a dismissed or legacy archived notification.
   *
   * The existing read timestamp is deliberately preserved because
   * inbox visibility and read state are independent.
   */
  public async restoreForRecipient(
    recipientId: string,
    notificationId: string,
  ): Promise<NotificationLifecycleMutationResult> {
    return db.transaction(async (transaction) => {
      const current = await this.lockLifecycleRecord(
        transaction,
        recipientId,
        notificationId,
      );

      if (!current || current.deletedAt) {
        return { outcome: "not_found" };
      }

      if (current.status === "active") {
        return {
          outcome: "unchanged",
          notification: current,
        };
      }

      const now = new Date();

      const [updated] = await transaction
        .update(notifications)
        .set({
          status: "active",
          updatedAt: now,
        })
        .where(
          and(
            eq(notifications.id, notificationId),
            eq(notifications.recipientUserId, recipientId),
            eq(notifications.status, current.status),
            isNull(notifications.deletedAt),
          ),
        )
        .returning({
          id: notifications.id,
          status: notifications.status,
          readAt: notifications.readAt,
          deletedAt: notifications.deletedAt,
          updatedAt: notifications.updatedAt,
        });

      if (!updated) {
        throw new AppError(
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          "Failed to restore notification.",
        );
      }

      return {
        outcome: "updated",
        notification: updated,
      };
    });
  }

  /**
   * Soft-delete a notification from the recipient's inbox.
   *
   * Delivery history and the existing notification status are preserved.
   * Repeated deletion by the same owner is a successful no-op.
   */
  public async deleteForRecipient(
    recipientId: string,
    notificationId: string,
  ): Promise<NotificationLifecycleMutationResult> {
    return db.transaction(async (transaction) => {
      const current = await this.lockLifecycleRecord(
        transaction,
        recipientId,
        notificationId,
      );

      if (!current) {
        return { outcome: "not_found" };
      }

      if (current.deletedAt) {
        return {
          outcome: "already_deleted",
          notification: current,
        };
      }

      const now = new Date();

      const [updated] = await transaction
        .update(notifications)
        .set({
          deletedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(notifications.id, notificationId),
            eq(notifications.recipientUserId, recipientId),
            isNull(notifications.deletedAt),
          ),
        )
        .returning({
          id: notifications.id,
          status: notifications.status,
          readAt: notifications.readAt,
          deletedAt: notifications.deletedAt,
          updatedAt: notifications.updatedAt,
        });

      if (!updated) {
        throw new AppError(
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          "Failed to delete notification.",
        );
      }

      return {
        outcome: "updated",
        notification: updated,
      };
    });
  }

  /**
   * Count unread notifications in the active inbox.
   *
   * Archived, dismissed and soft-deleted records are excluded.
   */
  public async countUnreadForRecipient(recipientId: string): Promise<number> {
    const [result] = await db
      .select({
        count: sql<number>`count(*)`,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientUserId, recipientId),
          eq(notifications.status, "active"),
          isNull(notifications.readAt),
          isNull(notifications.deletedAt),
        ),
      );

    return Number(result?.count ?? 0);
  }

  /**
   * Persist an inbox notification.
   *
   * The caller owns the transaction and must commit the processed-event
   * marker and this notification together.
   */
  public async create(
    transaction: DatabaseTransaction,
    input: NewNotification,
  ): Promise<Notification> {
    const [notification] = await transaction
      .insert(notifications)
      .values(input)
      .returning();

    if (!notification) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Failed to create notification.",
      );
    }

    return notification;
  }
}

export const notificationRepository = new NotificationRepository();
