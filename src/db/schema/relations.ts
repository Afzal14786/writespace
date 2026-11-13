import { relations } from "drizzle-orm";

import { articles } from "./articles";
import { commentReactions } from "./comment-reactions";
import { comments } from "./comments";
import { contentItems } from "./content-items";
import { contentMentions } from "./content-mentions";
import { contentReactions } from "./content-reactions";
import { contentSaves } from "./content-saves";
import { contentShares } from "./content-shares";
import { follows } from "./follows";
import { interactionEvents } from "./interaction-events";

import { notificationDeliveries } from "./notification-deliveries";
import { notificationDeliveryAttempts } from "./notification-delivery-attempts";
import { notificationGroupEvents } from "./notification-group-events";
import { notificationGroups } from "./notification-groups";
import { notificationPreferences } from "./notification-preferences";
import { notificationUserSettings } from "./notification-user-settings";
import { notifications } from "./notifications";

import { postMedia } from "./post-media";
import { posts } from "./posts";
import { users } from "./users";

/**
 * Drizzle relations mirror the foreign keys defined in each table.
 * The table schemas define the actual database constraints.
 */

export const usersRelations = relations(users, ({ many, one }) => ({
  contentItems: many(contentItems),
  comments: many(comments),

  contentReactions: many(contentReactions),
  commentReactions: many(commentReactions),
  contentSaves: many(contentSaves),
  contentShares: many(contentShares),
  contentMentions: many(contentMentions),

  interactionEvents: many(interactionEvents),

  notificationsReceived: many(notifications, {
    relationName: "notifications_received",
  }),

  notificationsTriggered: many(notifications, {
    relationName: "notifications_triggered",
  }),

  notificationGroups: many(notificationGroups),
  notificationPreferences: many(notificationPreferences),
  notificationSettings: one(notificationUserSettings),
  notificationDeliveries: many(notificationDeliveries),

  followers: many(follows, { relationName: "user_followers" }),
  following: many(follows, { relationName: "user_following" }),
}));

export const contentItemsRelations = relations(
  contentItems,
  ({ one, many }) => ({
    author: one(users, {
      fields: [contentItems.authorId],
      references: [users.id],
    }),

    post: one(posts),
    article: one(articles),

    comments: many(comments),
    reactions: many(contentReactions),
    saves: many(contentSaves),
    shares: many(contentShares),
    mentions: many(contentMentions),
  }),
);

export const postsRelations = relations(posts, ({ one, many }) => ({
  contentItem: one(contentItems, {
    fields: [posts.id],
    references: [contentItems.id],
  }),
  media: many(postMedia),
}));

export const articlesRelations = relations(articles, ({ one }) => ({
  contentItem: one(contentItems, {
    fields: [articles.id],
    references: [contentItems.id],
  }),
}));

export const postMediaRelations = relations(postMedia, ({ one }) => ({
  post: one(posts, {
    fields: [postMedia.postId],
    references: [posts.id],
  }),
}));

export const contentMentionsRelations = relations(
  contentMentions,
  ({ one }) => ({
    contentItem: one(contentItems, {
      fields: [contentMentions.contentItemId],
      references: [contentItems.id],
    }),

    mentionedUser: one(users, {
      fields: [contentMentions.mentionedUserId],
      references: [users.id],
    }),
  }),
);

export const commentsRelations = relations(comments, ({ one, many }) => ({
  contentItem: one(contentItems, {
    fields: [comments.contentItemId],
    references: [contentItems.id],
  }),

  author: one(users, {
    fields: [comments.authorId],
    references: [users.id],
  }),

  parent: one(comments, {
    fields: [comments.parentCommentId],
    references: [comments.id],
    relationName: "commentReplies",
  }),

  replies: many(comments, { relationName: "commentReplies" }),
  reactions: many(commentReactions),
}));

export const contentReactionsRelations = relations(
  contentReactions,
  ({ one }) => ({
    contentItem: one(contentItems, {
      fields: [contentReactions.contentItemId],
      references: [contentItems.id],
    }),

    user: one(users, {
      fields: [contentReactions.userId],
      references: [users.id],
    }),
  }),
);

export const commentReactionsRelations = relations(
  commentReactions,
  ({ one }) => ({
    comment: one(comments, {
      fields: [commentReactions.commentId],
      references: [comments.id],
    }),

    user: one(users, {
      fields: [commentReactions.userId],
      references: [users.id],
    }),
  }),
);

export const contentSavesRelations = relations(contentSaves, ({ one }) => ({
  contentItem: one(contentItems, {
    fields: [contentSaves.contentItemId],
    references: [contentItems.id],
  }),

  user: one(users, {
    fields: [contentSaves.userId],
    references: [users.id],
  }),
}));

export const contentSharesRelations = relations(contentShares, ({ one }) => ({
  contentItem: one(contentItems, {
    fields: [contentShares.contentItemId],
    references: [contentItems.id],
  }),

  user: one(users, {
    fields: [contentShares.userId],
    references: [users.id],
  }),
}));

export const notificationsRelations = relations(
  notifications,
  ({ one, many }) => ({
    recipient: one(users, {
      fields: [notifications.recipientUserId],
      references: [users.id],
      relationName: "notifications_received",
    }),

    actor: one(users, {
      fields: [notifications.actorUserId],
      references: [users.id],
      relationName: "notifications_triggered",
    }),

    group: one(notificationGroups, {
      fields: [notifications.groupId],
      references: [notificationGroups.id],
    }),

    groupEvents: many(notificationGroupEvents),
    deliveries: many(notificationDeliveries),
  }),
);

export const notificationGroupsRelations = relations(
  notificationGroups,
  ({ one, many }) => ({
    recipient: one(users, {
      fields: [notificationGroups.recipientUserId],
      references: [users.id],
    }),

    notifications: many(notifications),
    events: many(notificationGroupEvents),
    deliveries: many(notificationDeliveries),
  }),
);

export const notificationGroupEventsRelations = relations(
  notificationGroupEvents,
  ({ one }) => ({
    group: one(notificationGroups, {
      fields: [notificationGroupEvents.groupId],
      references: [notificationGroups.id],
    }),

    notification: one(notifications, {
      fields: [notificationGroupEvents.notificationId],
      references: [notifications.id],
    }),

    actor: one(users, {
      fields: [notificationGroupEvents.actorUserId],
      references: [users.id],
    }),
  }),
);

export const notificationPreferencesRelations = relations(
  notificationPreferences,
  ({ one }) => ({
    user: one(users, {
      fields: [notificationPreferences.userId],
      references: [users.id],
    }),
  }),
);

export const notificationUserSettingsRelations = relations(
  notificationUserSettings,
  ({ one }) => ({
    user: one(users, {
      fields: [notificationUserSettings.userId],
      references: [users.id],
    }),
  }),
);

export const notificationDeliveriesRelations = relations(
  notificationDeliveries,
  ({ one, many }) => ({
    notification: one(notifications, {
      fields: [notificationDeliveries.notificationId],
      references: [notifications.id],
    }),

    group: one(notificationGroups, {
      fields: [notificationDeliveries.groupId],
      references: [notificationGroups.id],
    }),

    recipient: one(users, {
      fields: [notificationDeliveries.recipientUserId],
      references: [users.id],
    }),

    attempts: many(notificationDeliveryAttempts),
  }),
);

export const notificationDeliveryAttemptsRelations = relations(
  notificationDeliveryAttempts,
  ({ one }) => ({
    delivery: one(notificationDeliveries, {
      fields: [notificationDeliveryAttempts.deliveryId],
      references: [notificationDeliveries.id],
    }),
  }),
);

export const followsRelations = relations(follows, ({ one }) => ({
  follower: one(users, {
    fields: [follows.followerId],
    references: [users.id],
    relationName: "user_following",
  }),

  following: one(users, {
    fields: [follows.followingId],
    references: [users.id],
    relationName: "user_followers",
  }),
}));

export const interactionEventsRelations = relations(
  interactionEvents,
  ({ one }) => ({
    actor: one(users, {
      fields: [interactionEvents.actorId],
      references: [users.id],
    }),
  }),
);
