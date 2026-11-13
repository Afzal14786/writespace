import { addEmailJob } from "@shared/queues/email.queue";

import { welcomeTemplate } from "./templates/welcome";
import { passwordResetTemplate } from "./templates/password-reset";
import { loginAlertTemplate } from "./templates/login-alert";
import { passwordUpdateTemplate } from "./templates/password-update";
import { profileUpdateTemplate } from "./templates/profile-update";
import { otpVerifyTemplate } from "./templates/otp-verify";

/**
 * Legacy email facade retained for existing authentication and user flows.
 *
 * This service only queues transactional emails.
 *
 * In-app notifications are created through the durable event-processing
 * pipeline, not by writing directly to the notification inbox.
 */
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
}

class NotificationService implements INotificationService {
  public async sendWelcomeEmail(
    to: string,
    username: string,
    _userId: string,
  ): Promise<void> {
    const { html, text } = welcomeTemplate({
      username,
      ctaLink: `${process.env.CLIENT_URL || "#"}/onboarding`,
    });

    await addEmailJob({
      to,
      subject: "Welcome to Writespace!",
      html,
      text,
    });
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

    await addEmailJob(
      {
        to,
        subject: "Reset Your Password",
        html,
        text,
      },
      {
        // Password-reset URLs contain sensitive reset credentials.
        // Do not retain permanently failed jobs containing those credentials.
        removeOnFail: true,
      },
    );
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

    await addEmailJob({
      to,
      subject: "New Login Detected",
      html,
      text,
    });
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
    const { html, text } = otpVerifyTemplate({
      email: to,
      otp,
    });

    await addEmailJob(
      {
        to,
        subject: "Verify Your Account - OTP",
        html,
        text,
      },
      {
        // OTP messages contain short-lived authentication codes.
        // Remove the job once all configured delivery attempts have failed.
        removeOnFail: true,
      },
    );
  }
}

export const notificationService = new NotificationService();
