import { Document } from "mongoose";

export enum NotificationType {
  WELCOME = "WELCOME",
  LIKE = "LIKE",
  COMMENT = "COMMENT",
  FOLLOW = "FOLLOW",
  SHARE = "SHARE",
  SYSTEM = "SYSTEM",
  LOGIN_ALERT = "LOGIN_ALERT",
}

export interface INotification extends Document {
  recipient: string; // User ID
  type: NotificationType;
  message: string;
  relatedId?: string; // ID of Post, User, etc.
  isRead: boolean;
  createdAt: Date;
}

export interface IEmailJob {
  to: string;
  subject: string;
  html: string;
}
