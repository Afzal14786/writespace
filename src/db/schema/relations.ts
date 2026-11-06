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
import { notifications } from "./notifications";
import { postMedia } from "./post-media";
import { posts } from "./posts";
import { users } from "./users";

/**
 * Drizzle query relations mirror the foreign keys defined in each table.
 * These declarations do not create database constraints; the table schemas
 * above define the actual foreign keys, primary keys, and indexes.
 */

export const usersRelations = relations(users, ({ many }) => ({
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

  // A user can appear as follower and as the followed user in separate rows.
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

    // One-to-one subtype rows share the parent's primary-key UUID.
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
      fields: [notifications.recipientId],
      references: [users.id],
      relationName: "notifications_received",
    }),
    actor: one(users, {
      fields: [notifications.actorId],
      references: [users.id],
      relationName: "notifications_triggered",
    }),
    deliveries: many(notificationDeliveries),
  }),
);

export const notificationDeliveriesRelations = relations(
  notificationDeliveries,
  ({ one }) => ({
    notification: one(notifications, {
      fields: [notificationDeliveries.notificationId],
      references: [notifications.id],
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
