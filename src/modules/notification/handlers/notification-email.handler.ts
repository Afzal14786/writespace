import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../../db";
import { users } from "../../../db/schema/users";

import type {
  NotificationDeliveryHandler,
  NotificationDeliveryHandlerResult,
} from "../contracts/delivery-handler.contract";

import { notificationEmailTemplate } from "../templates/notification-email";

import { mailer } from "@shared/infra/mailer";
import logger from "@config/logger";

/**
 * Classify SMTP failures without assuming that every network error
 * happened before the external email operation took effect.
 *
 * Nodemailer supplies `permanent` when the SMTP server responds.
 * When no server response exists, use the error code and SMTP command
 * to determine whether sending could have started.
 */
function classifySmtpError(error: unknown): NotificationDeliveryHandlerResult {
  if (typeof error !== "object" || error === null) {
    return {
      outcome: "ambiguous",
      errorCode: "smtp_outcome_unknown",
    };
  }

  const smtpError = error as {
    code?: unknown;
    command?: unknown;
    responseCode?: unknown;
    permanent?: unknown;
    timeoutType?: unknown;
  };

  const code =
    typeof smtpError.code === "string" ? smtpError.code.toUpperCase() : null;

  const command =
    typeof smtpError.command === "string"
      ? smtpError.command.toUpperCase()
      : null;

  const responseCode =
    typeof smtpError.responseCode === "number"
      ? String(smtpError.responseCode)
      : undefined;

  /*
   * An explicit SMTP response is the strongest evidence.
   * Do not classify solely from the numeric response-code range.
   */
  if (smtpError.permanent === true) {
    return {
      outcome: "permanent_failure",
      errorCode: "smtp_permanent_rejection",
      providerResponseCode: responseCode,
    };
  }

  if (smtpError.permanent === false) {
    return {
      outcome: "transient_failure",
      errorCode: "smtp_temporary_rejection",
      providerResponseCode: responseCode,
    };
  }

  /*
   * These SMTP commands occur before the message DATA transaction.
   * A connection failure at these stages means the message itself
   * has not been submitted for acceptance.
   */
  const preDataCommands = [
    "CONN",
    "EHLO",
    "HELO",
    "STARTTLS",
    "AUTH LOGIN",
    "AUTH PLAIN",
    "AUTH XOAUTH2",
    "MAIL FROM",
    "RCPT TO",
  ];

  const failedBeforeMessageData =
    command !== null &&
    preDataCommands.some((stage) => command.startsWith(stage));

  const failedDuringConnectionSetup = [
    "CONNECT_TIMEOUT",
    "GREETING_TIMEOUT",
    "UPGRADE_TIMEOUT",
  ].includes(
    typeof smtpError.timeoutType === "string" ? smtpError.timeoutType : "",
  );

  /*
   * DNS and connection-setup failures are safe to retry because
   * the SMTP server has not accepted the email.
   */
  if (
    code === "EDNS" ||
    (code === "ETIMEDOUT" &&
      (failedDuringConnectionSetup || failedBeforeMessageData)) ||
    ((code === "ECONNECTION" || code === "ESOCKET" || code === "ETLS") &&
      failedBeforeMessageData)
  ) {
    return {
      outcome: "transient_failure",
      errorCode: "smtp_connection_failure_before_send",
    };
  }

  /*
   * These indicate configuration, authentication or local envelope
   * problems that need correction rather than routine retries.
   */
  if (
    [
      "EAUTH",
      "ENOAUTH",
      "EOAUTH2",
      "ECONFIG",
      "EENVELOPE",
      "EMAXRECIPIENTS",
      "EREQUIRETLS",
    ].includes(code ?? "")
  ) {
    return {
      outcome: "permanent_failure",
      errorCode: "smtp_configuration_or_envelope_failure",
      providerResponseCode: responseCode,
    };
  }

  /*
   * A socket timeout, connection interruption during DATA, or an
   * unrecognized transport failure may happen after the server has
   * received the message.
   *
   * Do not automatically retry an uncertain external operation.
   */
  return {
    outcome: "ambiguous",
    errorCode: "smtp_outcome_unknown",
    providerResponseCode: responseCode,
  };
}

/**
 * Email channel handler for persisted inbox notifications.
 *
 * This handler currently supports notifications associated with an
 * inbox record. Email-only authentication workflows require their own
 * validated template and protected-action contracts and are not handled
 * by this generic notification template.
 */
export class NotificationEmailHandler implements NotificationDeliveryHandler {
  public readonly channel = "email" as const;

  public async deliver(
    context: Parameters<NotificationDeliveryHandler["deliver"]>[0],
  ): Promise<NotificationDeliveryHandlerResult> {
    const { delivery, notification, outboxEvent } = context;

    /*
     * This generic template needs a persisted notification.
     *
     * Email-only authentication messages will use dedicated templates
     * and an approved authentication-module integration.
     */
    if (!notification) {
      return {
        outcome: "permanent_failure",
        errorCode: "notification_email_context_missing",
      };
    }

    if (!delivery.recipientUserId) {
      return {
        outcome: "suppressed",
        errorCode: "notification_email_recipient_unavailable",
      };
    }

    /*
     * Verify recipient ownership again at the delivery boundary.
     * Do not let a malformed delivery record send another user's
     * notification to an unrelated email address.
     */
    if (notification.recipientUserId !== delivery.recipientUserId) {
      logger.error("Notification email recipient mismatch", {
        eventId: outboxEvent.id,
        deliveryId: delivery.id,
        notificationId: notification.id,
      });

      return {
        outcome: "permanent_failure",
        errorCode: "notification_email_recipient_mismatch",
      };
    }

    const [recipient] = await db
      .select({
        id: users.id,
        email: users.email,
        fullname: users.fullname,
        username: users.username,
        status: users.status,
      })
      .from(users)
      .where(eq(users.id, delivery.recipientUserId))
      .limit(1);

    if (!recipient) {
      return {
        outcome: "suppressed",
        errorCode: "notification_email_recipient_not_found",
      };
    }

    if (recipient.status !== "active") {
      return {
        outcome: "suppressed",
        errorCode: "notification_email_account_inactive",
      };
    }

    const parsedEmail = z.email().safeParse(recipient.email);

    if (!parsedEmail.success) {
      return {
        outcome: "permanent_failure",
        errorCode: "notification_email_address_invalid",
      };
    }

    const recipientName = recipient.fullname.trim() || recipient.username;

    const template = notificationEmailTemplate({
      recipientName,
      title: notification.title,
      body: notification.body,
    });

    try {
      const result = await mailer.sendEmail({
        to: recipient.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      });

      const normalizedEmail = recipient.email.toLowerCase();

      const wasAccepted = result.accepted.some(
        (address) => address.toLowerCase() === normalizedEmail,
      );

      const wasRejected = result.rejected.some(
        (address) => address.toLowerCase() === normalizedEmail,
      );

      if (wasRejected) {
        return {
          outcome: "permanent_failure",
          errorCode: "smtp_recipient_rejected",
          providerResponseCode: result.response.match(/^(\d{3})/)?.[1] ?? null,
          providerMessageId: result.messageId,
        };
      }

      if (!wasAccepted) {
        /*
         * Nodemailer completed the operation, but the recipient was
         * not present in the accepted list. Do not claim success.
         */
        return {
          outcome: "ambiguous",
          errorCode: "smtp_recipient_acceptance_unconfirmed",
          providerResponseCode: result.response.match(/^(\d{3})/)?.[1] ?? null,
          providerMessageId: result.messageId,
        };
      }

      return {
        outcome: "accepted",
        acceptedAt: new Date(),
        providerResponseCode: result.response.match(/^(\d{3})/)?.[1] ?? null,
        providerMessageId: result.messageId,
      };
    } catch (error) {
      logger.error("Notification email transport failed", {
        eventId: outboxEvent.id,
        deliveryId: delivery.id,
        notificationId: notification.id,
        error,
      });

      return classifySmtpError(error);
    }
  }
}

export const notificationEmailHandler = new NotificationEmailHandler();
