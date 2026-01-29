import nodemailer from "nodemailer";
import env from "../../config/env";
import dotenv from "dotenv";
dotenv.config();

interface MailOptions {
  to: string;
  subject: string;
  html: string;
}

/**
 * @class Mailer
 * @description Handles sending emails using Nodemailer via SMTP.
 */
class Mailer {
  private transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465, // true for 465, false for other ports
      requireTLS: true,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  }

  /**
   * Sends an email.
   * @param options {MailOptions} - Object containing 'to', 'subject', and 'html' content.
   */
  public async sendEmail(options: MailOptions): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: `WriteSpace <${env.SMTP_USER}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
      });
      console.log(`Email sent to: ${options.to}`);
    } catch (error) {
      console.error("Email send error:", error);
      // In a production app, we might want to queue failed emails via BullMQ instead of throwing immediately
      console.warn("Failed to send email. Check SMTP configuration.");
    }
  }
}

export const mailer = new Mailer();
