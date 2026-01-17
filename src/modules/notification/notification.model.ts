import mongoose, { Schema } from "mongoose";
import {
  INotification,
  NotificationType,
} from "./interface/notification.interface";

const notificationSchema = new Schema<INotification>(
  {
    recipient: {
      type: String,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(NotificationType),
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    relatedId: {
      type: String,
      required: false,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true, // Automatically manages createdAt and updatedAt
  },
);

// Index for fetching unread notifications quickly
notificationSchema.index({ recipient: 1, isRead: 1 });

export const NotificationModel = mongoose.model<INotification>(
  "Notification",
  notificationSchema,
);
