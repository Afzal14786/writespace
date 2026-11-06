import { eq } from "drizzle-orm";

import type { SeedTransaction } from "./seed-types";
import type { NewNotification } from "../../db/schema/notifications";
import type { NewNotificationDelivery } from "../../db/schema/notification-deliveries";

import {
  comments,
  contentItems,
  contentMentions,
  contentReactions,
  contentShares,
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

  // Match the display-name fallback used by notification.worker.ts.
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
      recipientId: user.id,
      actorId: null,
      type: "WELCOME",
      entityType: "SYSTEM",
      relatedId: null,
      message: `Welcome to Writespace, ${user.username}! We're glad you're here.`,
      metadata: {},
      isRead: false,
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
      recipientId: follow.recipientId,
      actorId: follow.actorId,
      type: "FOLLOW",
      entityType: "USER",
      relatedId: follow.actorId,
      message: formatActorMessage(follow.actorId, "started following you."),
      metadata: {},
      createdAt: follow.createdAt,
    });
  }

  // Mention notifications are based on the unique mention records.
  const mentionRows = await tx
    .select({
      recipientId: contentMentions.mentionedUserId,
      actorId: contentItems.authorId,
      contentItemId: contentMentions.contentItemId,
      contentType: contentItems.contentType,
      createdAt: contentMentions.createdAt,
    })
    .from(contentMentions)
    .innerJoin(
      contentItems,
      eq(contentMentions.contentItemId, contentItems.id),
    );

  for (const mention of mentionRows) {
    if (mention.recipientId === mention.actorId) continue;

    const contentLabel =
      mention.contentType === "article" ? "an article" : "a post";

    notificationRows.push({
      recipientId: mention.recipientId,
      actorId: mention.actorId,
      type: "MENTION",
      entityType: "CONTENT_ITEM",
      relatedId: mention.contentItemId,
      message: formatActorMessage(
        mention.actorId,
        `mentioned you in ${contentLabel}.`,
      ),
      metadata: {
        contentType: mention.contentType,
      },
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
    );

  for (const reaction of reactionRows) {
    if (reaction.recipientId === reaction.actorId) continue;

    notificationRows.push({
      recipientId: reaction.recipientId,
      actorId: reaction.actorId,
      type: "REACTION",
      entityType: "CONTENT_ITEM",
      relatedId: reaction.contentItemId,
      message: formatActorMessage(reaction.actorId, "reacted to your content."),
      metadata: {
        reactionType: reaction.reactionType,
      },
      createdAt: reaction.createdAt,
    });
  }

  // Comments and replies both contribute to the content author's activity.
  const commentRows = await tx
    .select({
      recipientId: contentItems.authorId,
      actorId: comments.authorId,
      contentItemId: comments.contentItemId,
      commentId: comments.id,
      parentCommentId: comments.parentCommentId,
      content: comments.content,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .innerJoin(contentItems, eq(comments.contentItemId, contentItems.id));

  for (const comment of commentRows) {
    if (comment.recipientId === comment.actorId) continue;

    const preview = comment.content.trim().slice(0, 100);

    notificationRows.push({
      recipientId: comment.recipientId,
      actorId: comment.actorId,
      type: "COMMENT",
      entityType: "CONTENT_ITEM",
      relatedId: comment.contentItemId,
      message: formatActorMessage(comment.actorId, `commented: "${preview}"`),
      metadata: {
        commentId: comment.commentId,
        parentCommentId: comment.parentCommentId,
      },
      createdAt: comment.createdAt,
    });
  }

  // Shares notify the author of the shared content.
  const shareRows = await tx
    .select({
      recipientId: contentItems.authorId,
      actorId: contentShares.userId,
      contentItemId: contentShares.contentItemId,
      platform: contentShares.platform,
      createdAt: contentShares.createdAt,
    })
    .from(contentShares)
    .innerJoin(contentItems, eq(contentShares.contentItemId, contentItems.id));

  for (const share of shareRows) {
    if (share.recipientId === share.actorId) continue;

    notificationRows.push({
      recipientId: share.recipientId,
      actorId: share.actorId,
      type: "SHARE",
      entityType: "CONTENT_ITEM",
      relatedId: share.contentItemId,
      message: formatActorMessage(share.actorId, "shared your content."),
      metadata: {
        platform: share.platform,
      },
      createdAt: share.createdAt,
    });
  }

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
        isRead: index % 3 === 0,
      })),
    )
    .returning({
      id: notifications.id,
      createdAt: notifications.createdAt,
    });

  // Seed in-app delivery records directly.
  // These records are not submitted to the email queue.
  const deliveryRows: NewNotificationDelivery[] = insertedNotifications.map(
    (notification) => ({
      notificationId: notification.id,
      channel: "IN_APP",
      status: "SENT",
      attemptCount: 1,
      sentAt: notification.createdAt,
      lastError: null,
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
