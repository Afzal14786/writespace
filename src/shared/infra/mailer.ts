import nodemailer from "nodemailer";
import env from "@config/env";
import dotenv from "dotenv";

dotenv.config();

interface MailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface MailSendResult {
  messageId: string;
  response: string;
  accepted: string[];
  rejected: string[];
}

/**
 * Normalize a Nodemailer recipient entry.
 *
 * Nodemailer may represent a recipient as a plain string or an
 * address object. Treat the value as untrusted input at this boundary.
 */
function normalizeAddress(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "address" in value &&
    typeof value.address === "string"
  ) {
    return value.address;
  }

  return null;
}

/**
 * Convert Nodemailer's recipient collection into a safe string array.
 */
function normalizeAddresses(values: unknown[]): string[] {
  return values
    .map(normalizeAddress)
    .filter((address): address is string => address !== null);
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
      secure: env.SMTP_PORT === 465,
      requireTLS: true,

      // Bound SMTP connection and response waiting times.
      connectionTimeout: env.SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: env.SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: env.SMTP_SOCKET_TIMEOUT_MS,

      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  }

  /**
   * Sends an email and returns the SMTP transport result.
   *
   * SMTP acceptance is not proof that the email reached the recipient's
   * inbox. The notification delivery service records this as "accepted".
   */
  public async sendEmail(options: MailOptions): Promise<MailSendResult> {
    const result = await this.transporter.sendMail({
      from: `Writespace <${env.SMTP_USER}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    // Nodemailer result values are normalized at the infrastructure boundary.
    const accepted: unknown[] = result.accepted;
    const rejected: unknown[] = result.rejected;

    return {
      messageId: result.messageId,
      response: result.response,
      accepted: normalizeAddresses(accepted),
      rejected: normalizeAddresses(rejected),
    };
  }
}

export const mailer = new Mailer();
