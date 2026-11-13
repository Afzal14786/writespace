import { and, eq, isNull } from "drizzle-orm";

import type { SeedTransaction } from "./seed-types";
import type { NewNotification } from "../../db/schema/notifications";
import type { NewNotificationDelivery } from "../../db/schema/notification-deliveries";

import { NOTIFICATION_POLICY_VERSION } from "../../modules/notification/domain/notification-policy.registry";

import {
  comments,
  contentItems,
  contentMentions,
  contentReactions,
  follows,
  notificationDeliveries,
  notifications,
  users,
} from "../../db/schema";

export async function seedNotifications(tx: SeedTransaction) {
  const userRows = await tx
    .select({
      id: users.id,
      fullname: users.fullname,
      username: users.username,
      createdAt: users.createdAt,
    })
    .from(users);

  // Match the display-name fallback used by the notification processor.
  const actorNames = new Map(
    userRows.map((user) => [user.id, user.fullname || user.username]),
  );

  const formatActorMessage = (actorId: string, action: string) => {
    const actorName = actorNames.get(actorId);

    if (!actorName) {
      throw new Error(`Could not find notification actor: ${actorId}`);
    }

    return `${actorName} ${action}`;
  };

  const notificationRows: NewNotification[] = [];

  // Welcome notifications have no actor because they are system-generated.
  for (const user of userRows) {
    notificationRows.push({
      recipientUserId: user.id,
      actorUserId: null,
      notificationType: "WELCOME",
      category: "platform",
      title: "Welcome to Writespace",
      body: `Welcome to Writespace, ${user.username}! We're glad you're here.`,
      presentationData: {},
      resourceType: "user",
      resourceId: user.id,
      actionType: "open_resource",
      status: "active",
      createdAt: user.createdAt,
    });
  }

  // A follow notification is delivered to the user being followed.
  const followRows = await tx
    .select({
      recipientId: follows.followingId,
      actorId: follows.followerId,
      createdAt: follows.createdAt,
    })
    .from(follows);

  for (const follow of followRows) {
    if (follow.recipientId === follow.actorId) continue;

    notificationRows.push({
      recipientUserId: follow.recipientId,
      actorUserId: follow.actorId,
      notificationType: "FOLLOW",
      category: "social",
      title: "New follower",
      body: formatActorMessage(follow.actorId, "started following you."),
      presentationData: {},
      resourceType: "user",
      resourceId: follow.actorId,
      actionType: "open_resource",
      createdAt: follow.createdAt,
    });
  }

  // Mention notifications are based on the unique mention lookup records.
  const mentionRows = await tx
    .select({
      recipientId: contentMentions.mentionedUserId,
      actorId: contentItems.authorId,
      contentItemId: contentMentions.contentItemId,
      contentType: contentItems.contentType,
      createdAt: contentMentions.createdAt,
    })
    .from(contentMentions)
    .innerJoin(contentItems, eq(contentMentions.contentItemId, contentItems.id))
    .where(eq(contentItems.status, "published"));

  for (const mention of mentionRows) {
    if (mention.recipientId === mention.actorId) continue;

    const contentLabel =
      mention.contentType === "article" ? "an article" : "a post";

    notificationRows.push({
      recipientUserId: mention.recipientId,
      actorUserId: mention.actorId,
      notificationType: "MENTION",
      category: "social",
      title: "You were mentioned",
      body: formatActorMessage(
        mention.actorId,
        `mentioned you in ${contentLabel}.`,
      ),
      presentationData: {
        contentType: mention.contentType,
      },
      resourceType: "content_item",
      resourceId: mention.contentItemId,
      actionType: "open_resource",
      createdAt: mention.createdAt,
    });
  }

  // Content reactions notify the author of the corresponding content item.
  const reactionRows = await tx
    .select({
      recipientId: contentItems.authorId,
      actorId: contentReactions.userId,
      contentItemId: contentReactions.contentItemId,
      reactionType: contentReactions.reactionType,
      createdAt: contentReactions.createdAt,
    })
    .from(contentReactions)
    .innerJoin(
      contentItems,
      eq(contentReactions.contentItemId, contentItems.id),
    )
    .where(eq(contentItems.status, "published"));

  for (const reaction of reactionRows) {
    if (reaction.recipientId === reaction.actorId) continue;

    notificationRows.push({
      recipientUserId: reaction.recipientId,
      actorUserId: reaction.actorId,
      notificationType: "REACTION",
      category: "social",
      title: "New reaction",
      body: formatActorMessage(reaction.actorId, "reacted to your content."),
      presentationData: {
        reactionType: reaction.reactionType,
      },
      resourceType: "content_item",
      resourceId: reaction.contentItemId,
      actionType: "open_resource",
      createdAt: reaction.createdAt,
    });
  }

  // Phase 2: only top-level comments generate comment notifications.
  // Replies will have their own notification behavior in Phase 3.
  const commentRows = await tx
    .select({
      recipientId: contentItems.authorId,
      actorId: comments.authorId,
      contentItemId: comments.contentItemId,
      commentId: comments.id,
      content: comments.content,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .innerJoin(contentItems, eq(comments.contentItemId, contentItems.id))
    .where(
      and(
        isNull(comments.parentCommentId),
        eq(contentItems.status, "published"),
      ),
    );

  for (const comment of commentRows) {
    if (comment.recipientId === comment.actorId) continue;

    const preview = comment.content.trim().slice(0, 100);

    notificationRows.push({
      recipientUserId: comment.recipientId,
      actorUserId: comment.actorId,
      notificationType: "COMMENT",
      category: "social",
      title: "New comment",
      body: formatActorMessage(comment.actorId, `commented: "${preview}"`),
      presentationData: {
        contentItemId: comment.contentItemId,
        commentPreview: preview,
      },
      resourceType: "comment",
      resourceId: comment.commentId,
      actionType: "open_resource",
      createdAt: comment.createdAt,
    });
  }

  // External shares are intentionally excluded from inbox notifications.
  // Their records and shareCount remain managed by the interactions module.

  if (notificationRows.length === 0) {
    return {
      notifications: 0,
      deliveries: 0,
    };
  }

  // Insert notifications first so their generated IDs can be used by deliveries.
  const insertedNotifications = await tx
    .insert(notifications)
    .values(
      notificationRows.map((notification, index) => ({
        ...notification,

        // Keep a predictable mixture of read and unread demo notifications.
        readAt: index % 3 === 0 ? notification.createdAt : null,
      })),
    )
    .returning({
      id: notifications.id,
      recipientUserId: notifications.recipientUserId,
      createdAt: notifications.createdAt,
    });

  /*
   * Seed historical realtime delivery records.
   * These are marked as delivered demo records and are not submitted
   * to the notification workers or external email queue.
   */
  const deliveryRows: NewNotificationDelivery[] = insertedNotifications.map(
    (notification) => ({
      notificationId: notification.id,
      recipientUserId: notification.recipientUserId,
      channel: "realtime",
      status: "delivered",
      idempotencyKey: `seed:realtime:${notification.id}`,
      attemptCount: 1,
      policyVersion: NOTIFICATION_POLICY_VERSION,
      eligibilityDecision: "eligible",
      reasonCode: "seeded_notification",
      preferenceEvaluatedAt: notification.createdAt,
      acceptedAt: notification.createdAt,
      confirmedDeliveredAt: notification.createdAt,
      createdAt: notification.createdAt,
      updatedAt: notification.createdAt,
    }),
  );

  await tx.insert(notificationDeliveries).values(deliveryRows);

  return {
    notifications: insertedNotifications.length,
    deliveries: deliveryRows.length,
  };
}
