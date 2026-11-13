import { UnrecoverableError, Worker } from "bullmq";

import { mailer } from "../infra/mailer";
import env from "@config/env";
import { bullmqRedisConnection } from "@config/bullmq";

import type { IEmailPayload } from "@modules/notification/interface/email.interface";
import { EMAIL_QUEUE_NAME } from "./email.queue";

import logger from "@config/logger";

// Keep OTP email delivery aligned with the registration OTP expiration.
const OTP_EXPIRE_MS = 10 * 60 * 1000;

/**
 * Values returned by the email worker and stored as BullMQ job results.
 */
type EmailWorkerResult =
  | {
      status: "expired";
    }
  | {
      status: "accepted";
      messageId: string;
    };

interface SmtpErrorMetadata {
  code?: unknown;
  originalCode?: unknown;
  command?: unknown;
  responseCode?: unknown;
  permanent?: unknown;
  timeoutType?: unknown;
  message?: unknown;
  rejectedErrors?: unknown;
}

/**
 * Safely read Nodemailer's extended error properties.
 *
 * Nodemailer attaches SMTP-specific metadata to ordinary Error objects.
 * These properties are not part of the standard JavaScript Error type.
 */
function getSmtpErrorMetadata(error: unknown): SmtpErrorMetadata | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  return error as SmtpErrorMetadata;
}

/**
 * Extract a readable error message without assuming that an unknown
 * thrown value is an Error instance.
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * Identify SMTP failures that definitely occurred before message DATA.
 *
 * A connection failure at these stages means the SMTP server has not
 * accepted the actual email message, so a bounded retry is safe.
 */
function failedBeforeMessageData(command: string | null): boolean {
  if (!command) {
    return false;
  }

  return /^(CONN|EHLO|HELO|STARTTLS|AUTH\b|MAIL FROM\b|RCPT TO\b)/i.test(
    command,
  );
}

/**
 * Classify a thrown Nodemailer error for the legacy BullMQ email queue.
 *
 * Temporary failures are returned as ordinary Error instances so BullMQ
 * can apply its configured retry policy.
 *
 * Permanent or uncertain failures use UnrecoverableError to avoid
 * automatically sending potentially duplicate authentication emails.
 *
 * Unlike the new durable notification pipeline, this legacy queue does
 * not persist an external delivery outcome in PostgreSQL. Therefore,
 * uncertain SMTP outcomes must not be retried blindly.
 */
function classifyEmailTransportError(error: unknown): Error {
  const metadata = getSmtpErrorMetadata(error);
  const message = getErrorMessage(error);

  if (!metadata) {
    return new UnrecoverableError(
      `Email delivery failed with an unrecognized error: ${message}`,
    );
  }

  const code =
    typeof metadata.code === "string" ? metadata.code.toUpperCase() : null;

  const originalCode =
    typeof metadata.originalCode === "string"
      ? metadata.originalCode.toUpperCase()
      : null;

  const command =
    typeof metadata.command === "string"
      ? metadata.command.toUpperCase()
      : null;

  const responseCode =
    typeof metadata.responseCode === "number" ? metadata.responseCode : null;

  const timeoutType =
    typeof metadata.timeoutType === "string"
      ? metadata.timeoutType.toUpperCase()
      : null;

  /*
   * When every SMTP recipient is rejected, Nodemailer can attach
   * rejectedErrors containing the individual rejection details.
   *
   * Inspect those errors instead of relying only on EENVELOPE.
   */
  const rejectedErrors = Array.isArray(metadata.rejectedErrors)
    ? metadata.rejectedErrors
        .map(getSmtpErrorMetadata)
        .filter((item): item is SmtpErrorMetadata => item !== null)
    : [];

  const rejectionErrors = [metadata, ...rejectedErrors];

  /*
   * Nodemailer's explicit permanent classification takes precedence.
   *
   * A permanent SMTP rejection must not consume routine queue retries.
   */
  if (rejectionErrors.some((item) => item.permanent === true)) {
    return new UnrecoverableError(`Permanent SMTP rejection: ${message}`);
  }

  /*
   * Nodemailer marks temporary server rejections, including SMTP 503,
   * with permanent=false.
   */
  if (rejectionErrors.some((item) => item.permanent === false)) {
    return new Error(`Temporary SMTP rejection: ${message}`);
  }

  /*
   * Fall back to the SMTP response code when Nodemailer has not
   * supplied its permanent classification.
   *
   * SMTP 503 is deliberately treated as temporary.
   */
  if (
    responseCode !== null &&
    (responseCode === 503 || (responseCode >= 400 && responseCode < 500))
  ) {
    return new Error(`Temporary SMTP rejection: ${message}`);
  }

  if (responseCode !== null && responseCode >= 500 && responseCode < 600) {
    return new UnrecoverableError(`Permanent SMTP rejection: ${message}`);
  }

  /*
   * DNS and basic connection-establishment failures happen before
   * the SMTP server can accept an email.
   *
   * Keep these retryable, with BullMQ's attempts and backoff.
   */
  const connectionSetupFailureCodes = [
    "EDNS",
    "ECONNREFUSED",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "EAI_AGAIN",
    "ENOTFOUND",
  ];

  if (
    (code !== null && connectionSetupFailureCodes.includes(code)) ||
    (originalCode !== null &&
      connectionSetupFailureCodes.includes(originalCode))
  ) {
    return new Error(`SMTP connection setup failed: ${message}`);
  }

  /*
   * Nodemailer provides timeoutType to distinguish connection setup
   * timeouts from socket inactivity timeouts.
   *
   * Connection, greeting and TLS-upgrade timeouts happen before
   * message DATA and are safe to retry.
   */
  if (
    code === "ETIMEDOUT" &&
    ["CONNECT_TIMEOUT", "GREETING_TIMEOUT", "UPGRADE_TIMEOUT"].includes(
      timeoutType ?? "",
    )
  ) {
    return new Error(`SMTP connection setup timed out: ${message}`);
  }

  /*
   * Some socket or connection errors expose the SMTP command that
   * was in progress. Retry only when the command proves that message
   * DATA had not started.
   */
  if (
    ["ECONNECTION", "ESOCKET", "ETIMEDOUT"].includes(code ?? "") &&
    failedBeforeMessageData(command)
  ) {
    return new Error(`SMTP failed before message transmission: ${message}`);
  }

  /*
   * Configuration, authentication, envelope and content errors
   * generally require correction rather than another send attempt.
   *
   * If a temporary server response was received, it was handled above.
   */
  const nonRetryableCodes = [
    "EAUTH",
    "ENOAUTH",
    "EOAUTH2",
    "ECONFIG",
    "EREQUIRETLS",
    "EENVELOPE",
    "EMAXRECIPIENTS",
    "EFILEACCESS",
    "EURLACCESS",
    "EOTP",
  ];

  if (nonRetryableCodes.includes(code ?? "")) {
    return new UnrecoverableError(
      `Email configuration or envelope failure: ${message}`,
    );
  }

  /*
   * Socket inactivity, connection loss during DATA, protocol errors
   * and unrecognized transport failures can occur after the server
   * has accepted the email.
   *
   * The legacy queue has no durable outcome ledger to resolve that
   * uncertainty. Do not automatically send the email again.
   */
  return new UnrecoverableError(
    `Email outcome is uncertain; automatic retry suppressed: ${message}`,
  );
}

export const emailWorker = new Worker<IEmailPayload, EmailWorkerResult>(
  EMAIL_QUEUE_NAME,
  async (job) => {
    const jobAge = Date.now() - job.timestamp;

    /*
     * An OTP email must not be delivered after its corresponding
     * registration code has expired.
     *
     * Returning successfully completes the obsolete job. The queue
     * removes successfully completed jobs through removeOnComplete.
     */
    if (
      job.data.subject === "Verify Your Account - OTP" &&
      jobAge > OTP_EXPIRE_MS
    ) {
      logger.warn("Skipping expired OTP email job", {
        jobId: job.id,
        ageMs: jobAge,
      });

      return {
        status: "expired",
      };
    }

    logger.info("Processing transactional email job", {
      jobId: job.id,
      subject: job.data.subject,
    });

    try {
      const result = await mailer.sendEmail({
        to: job.data.to,
        subject: job.data.subject,
        html: job.data.html,
        text: job.data.text,
      });

      const normalizedRecipient = job.data.to.trim().toLowerCase();

      const wasAccepted = result.accepted.some(
        (address) => address.trim().toLowerCase() === normalizedRecipient,
      );

      const wasRejected = result.rejected.some(
        (address) => address.trim().toLowerCase() === normalizedRecipient,
      );

      if (wasAccepted && wasRejected) {
        /*
         * Conflicting SMTP recipient information must not be treated
         * as an ordinary successful or retryable send.
         */
        throw new UnrecoverableError(
          "SMTP returned conflicting acceptance and rejection results.",
        );
      }

      if (wasRejected) {
        const responseCode = Number(result.response.match(/^\s*(\d{3})/)?.[1]);

        /*
         * A temporary recipient rejection is safe to retry because
         * the recipient was not accepted for this message.
         *
         * A 503 response is also treated as temporary.
         */
        if (
          Number.isInteger(responseCode) &&
          (responseCode === 503 || (responseCode >= 400 && responseCode < 500))
        ) {
          throw new Error(
            `SMTP temporarily rejected recipient ${normalizedRecipient}: ${result.response}`,
          );
        }

        /*
         * A permanent rejection, or a rejection without a reliable
         * SMTP response code, is not automatically retried.
         */
        throw new UnrecoverableError(
          `SMTP did not accept recipient ${normalizedRecipient}: ${result.response}`,
        );
      }

      if (!wasAccepted) {
        /*
         * A resolved sendMail() call is not sufficient proof that
         * the intended recipient was accepted by the SMTP server.
         */
        throw new UnrecoverableError(
          "SMTP recipient acceptance could not be confirmed.",
        );
      }

      logger.info("Transactional email accepted by SMTP", {
        jobId: job.id,
        messageId: result.messageId,
      });

      return {
        status: "accepted",
        messageId: result.messageId,
      };
    } catch (error) {
      logger.error("Transactional email delivery failed", {
        jobId: job.id,
        subject: job.data.subject,
        error,
      });

      /*
       * Preserve an existing UnrecoverableError. Otherwise classify
       * the Nodemailer failure before allowing BullMQ to retry it.
       */
      if (error instanceof UnrecoverableError) {
        throw error;
      }

      throw classifyEmailTransportError(error);
    }
  },
  {
    connection: bullmqRedisConnection,
    concurrency: env.EMAIL_WORKER_CONCURRENCY,
  },
);

emailWorker.on("completed", (job, result) => {
  logger.info("Email job completed", {
    jobId: job.id,
    status: result.status,
  });
});

emailWorker.on("failed", (job, error) => {
  logger.error("Email job failed", {
    jobId: job?.id,
    error: error.message,
    attemptsMade: job?.attemptsMade,
    maxAttempts: job?.opts.attempts,
  });
});

emailWorker.on("error", (error) => {
  logger.error("Email worker error", { error });
});
