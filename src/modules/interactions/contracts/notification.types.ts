export const notificationTypeValues = [
  "WELCOME",
  "REACTION",
  "COMMENT",
  "FOLLOW",
  "SHARE",
  "MENTION",
  "REPORT",
  "MESSAGE",
  "SYSTEM",
  "LOGIN_ALERT",
  "PASSWORD_CHANGED",
  "PASSWORD_RESET",
  "ACCOUNT_STATUS",
] as const;

export type NotificationType = (typeof notificationTypeValues)[number];

export const notificationEntityTypeValues = [
  "CONTENT_ITEM",
  "COMMENT",
  "USER",
  "MESSAGE",
  "REPORT",
  "SYSTEM",
] as const;

export type NotificationEntityType =
  (typeof notificationEntityTypeValues)[number];

/**
 * Transitional notification input contract.
 *
 * New notification creation should use validated domain events and
 * the notification processor rather than direct inbox insertion.
 */
export interface CreateNotificationInput {
  recipientId: string;
  actorId?: string;
  type: NotificationType;
  entityType?: NotificationEntityType;
  relatedId?: string;
  message: string;
  metadata?: Record<string, unknown>;
}
