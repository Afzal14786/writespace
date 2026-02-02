import { addEmailJob } from "../../shared/queues/email.queue";
import { welcomeTemplate } from "./templates/welcome";
import { passwordResetTemplate } from "./templates/password-reset";
import { loginAlertTemplate } from "./templates/login-alert";
import { passwordUpdateTemplate } from "./templates/password-update";
import { profileUpdateTemplate } from "./templates/profile-update";
import { otpVerifyTemplate } from "./templates/otp-verify";
import { NotificationType } from "./interface/notification.interface";
import { addInteractionJob } from "../../shared/queues/interaction.queue";

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
}

class NotificationService implements INotificationService {
  public async sendWelcomeEmail(
    to: string,
    username: string,
    userId: string,
  ): Promise<void> {
    const html = welcomeTemplate({
      username,
      ctaLink: `${process.env.CLIENT_URL || "#"}/onboarding`,
    });
    await addEmailJob({
      to,
      subject: "Welcome to Writespace!",
      html,
    });

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
    const html = passwordResetTemplate({ username, resetLink: resetUrl });
    await addEmailJob({
      to,
      subject: "Reset Your Password",
      html,
    });
  }

  public async sendLoginAlert(
    to: string,
    username: string,
    ip: string,
    userId: string,
  ): Promise<void> {
    const time = new Date().toLocaleString();
    const html = loginAlertTemplate({
      username,
      time,
      ip,
      secureAccountLink: `${process.env.CLIENT_URL}/settings/security`,
    });
    await addEmailJob({
      to,
      subject: "New Login Detected",
      html,
    });
  }

  public async sendPasswordUpdateEmail(
    to: string,
    username: string,
  ): Promise<void> {
    const html = passwordUpdateTemplate({
      username,
      contactSupportLink: `${process.env.CLIENT_URL}/contact`,
    });
    await addEmailJob({
      to,
      subject: "Password Updated Successfully",
      html,
    });
  }

  public async sendProfileUpdateEmail(
    to: string,
    username: string,
  ): Promise<void> {
    const html = profileUpdateTemplate({
      username,
      profileLink: `${process.env.CLIENT_URL}/profile`,
    });
    await addEmailJob({
      to,
      subject: "Profile Information Updated",
      html,
    });
  }

  public async sendOtpEmail(to: string, otp: string): Promise<void> {
    const html = otpVerifyTemplate({ email: to, otp });
    await addEmailJob({
      to,
      subject: "Verify Your Account - OTP",
      html,
    });
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
    );
  }

  private async createInAppNotification(
    recipient: string,
    type: NotificationType,
    message: string,
    relatedId?: string,
  ): Promise<void> {
    await addInteractionJob({
      recipientId: recipient,
      type,
      message,
      relatedId,
    });
  }
}

export const notificationService = new NotificationService();
