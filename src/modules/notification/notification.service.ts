import { addEmailJob } from "../../shared/queues/email.queue";
import { welcomeTemplate } from "./templates/welcome";
import { passwordResetTemplate } from "./templates/password-reset";
import { loginAlertTemplate } from "./templates/login-alert";
import { passwordUpdateTemplate } from "./templates/password-update";
import { profileUpdateTemplate } from "./templates/profile-update";
import { otpVerifyTemplate } from "./templates/otp-verify";
import { NotificationType } from "./interface/notification.interface";
import { addInteractionJob } from "../../shared/queues/interaction.queue";

import { db } from "../../db";
import { notifications } from "../../db/schema/notifications";
import { users } from "../../db/schema/users";
import { eq, desc, and, inArray, sql } from "drizzle-orm";

interface INotificationService {
  sendWelcomeEmail(to: string, username: string, userId: string): Promise<void>;
  sendPasswordResetEmail(
    to: string,
    username: string,
    resetUrl: string,
  ): Promise<void>;
  sendLoginAlert(
    to: string,
    username: string,
    ip: string,
    userId: string,
  ): Promise<void>;
  sendPasswordUpdateEmail(to: string, username: string): Promise<void>;
  sendProfileUpdateEmail(to: string, username: string): Promise<void>;
  sendOtpEmail(to: string, otp: string): Promise<void>;
  sendLikeNotification(
    recipientId: string,
    actorId: string,
    postId: string,
  ): Promise<void>;
  sendCommentNotification(
    recipientId: string,
    actorId: string,
    postId: string,
    commentPreview: string,
  ): Promise<void>;
  sendFollowNotification(recipientId: string, actorId: string): Promise<void>;
  sendShareNotification(
    recipientId: string,
    actorId: string,
    postId: string,
  ): Promise<void>;

  getUserNotifications(
    userId: string,
    limit?: number,
    offset?: number,
  ): Promise<{ notifications: unknown[]; unreadCount: number }>;
  markAsRead(notificationIds: number[], userId: string): Promise<void>;
  markAllAsRead(userId: string): Promise<void>;
}

class NotificationService implements INotificationService {
  public async sendWelcomeEmail(
    to: string,
    username: string,
    userId: string,
  ): Promise<void> {
    const { html, text } = welcomeTemplate({
      username,
      ctaLink: `${process.env.CLIENT_URL || "#"}/onboarding`,
    });

    await addEmailJob({ to, subject: "Welcome to Writespace!", html, text });

    await this.createInAppNotification(
      userId,
      NotificationType.WELCOME,
      `Welcome to Writespace, ${username}! We're glad you're here.`,
    );
  }

  public async sendPasswordResetEmail(
    to: string,
    username: string,
    resetUrl: string,
  ): Promise<void> {
    const { html, text } = passwordResetTemplate({
      username,
      resetLink: resetUrl,
    });
    await addEmailJob({ to, subject: "Reset Your Password", html, text });
  }

  public async sendLoginAlert(
    to: string,
    username: string,
    ip: string,
    _userId: string,
  ): Promise<void> {
    const time = new Date().toLocaleString();
    const { html, text } = loginAlertTemplate({
      username,
      time,
      ip,
      secureAccountLink: `${process.env.CLIENT_URL}/settings/security`,
    });
    await addEmailJob({ to, subject: "New Login Detected", html, text });
  }

  public async sendPasswordUpdateEmail(
    to: string,
    username: string,
  ): Promise<void> {
    const { html, text } = passwordUpdateTemplate({
      username,
      contactSupportLink: `${process.env.CLIENT_URL}/contact`,
    });
    await addEmailJob({
      to,
      subject: "Password Updated Successfully",
      html,
      text,
    });
  }

  public async sendProfileUpdateEmail(
    to: string,
    username: string,
  ): Promise<void> {
    const { html, text } = profileUpdateTemplate({
      username,
      profileLink: `${process.env.CLIENT_URL}/profile`,
    });
    await addEmailJob({
      to,
      subject: "Profile Information Updated",
      html,
      text,
    });
  }

  public async sendOtpEmail(to: string, otp: string): Promise<void> {
    const { html, text } = otpVerifyTemplate({ email: to, otp });
    await addEmailJob({ to, subject: "Verify Your Account - OTP", html, text });
  }

  public async sendLikeNotification(
    recipientId: string,
    actorId: string,
    postId: string,
  ): Promise<void> {
    if (recipientId === actorId) return;
    await this.createInAppNotification(
      recipientId,
      NotificationType.LIKE,
      "liked your post.",
      postId,
      actorId
    );
  }

  public async sendCommentNotification(
    recipientId: string,
    actorId: string,
    postId: string,
    commentPreview: string,
  ): Promise<void> {
    if (recipientId === actorId) return;
    await this.createInAppNotification(
      recipientId,
      NotificationType.COMMENT,
      `commented: "${commentPreview}"`,
      postId,
      actorId
    );
  }

  public async sendFollowNotification(
    recipientId: string,
    actorId: string,
  ): Promise<void> {
    if (recipientId === actorId) return;
    await this.createInAppNotification(
      recipientId,
      NotificationType.FOLLOW,
      "started following you.",
      actorId,
      actorId
    );
  }

  public async sendShareNotification(
    recipientId: string,
    actorId: string,
    postId: string,
  ): Promise<void> {
    if (recipientId === actorId) return;
    await this.createInAppNotification(
      recipientId,
      NotificationType.SHARE,
      "shared your post.",
      postId,
      actorId
    );
  }

  private async createInAppNotification(
    recipient: string,
    type: NotificationType,
    message: string,
    relatedId?: string,
    actorId?: string
  ): Promise<void> {
    await addInteractionJob({
      recipientId: recipient,
      type,
      message,
      relatedId,
      actorId
    });
  }

  public async getUserNotifications(
    userId: string,
    limit: number = 20,
    offset: number = 0,
  ) {
    const rawNotifications = await db
      .select({
        id: notifications.id,
        type: notifications.type,
        message: notifications.message,
        relatedId: notifications.relatedId,
        isRead: notifications.isRead,
        createdAt: notifications.createdAt,
        actorId: users.id,
        actorUsername: users.username,
        actorFullname: users.fullname,
        actorProfileImageUrl: users.profileImageUrl,
      })
      .from(notifications)
      .leftJoin(users, eq(notifications.actorId, users.id))
      .where(eq(notifications.recipientId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);

    const formattedNotifications = rawNotifications.map((row) => ({
      id: row.id,
      type: row.type,
      message: row.message,
      relatedId: row.relatedId,
      isRead: row.isRead,
      createdAt: row.createdAt,
      actor: row.actorId
        ? {
            id: row.actorId,
            username: row.actorUsername,
            fullname: row.actorFullname,
            profileImageUrl: row.actorProfileImageUrl,
          }
        : null,
    }));

    const [unreadCountResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, userId),
          eq(notifications.isRead, false),
        ),
      );

    return {
      notifications: formattedNotifications,
      unreadCount: Number(unreadCountResult?.count || 0),
    };
  }

  public async markAsRead(
    notificationIds: number[],
    userId: string,
  ): Promise<void> {
    if (!notificationIds || notificationIds.length === 0) return;

    await db
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(
          inArray(notifications.id, notificationIds),
          eq(notifications.recipientId, userId),
        ),
      );
  }

  public async markAllAsRead(userId: string): Promise<void> {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.recipientId, userId));
  }
}

export const notificationService = new NotificationService();