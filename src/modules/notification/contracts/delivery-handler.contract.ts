import type { OutboxEvent } from "../../../db/schema/outbox-events";
import type { Notification } from "../../../db/schema/notifications";
import type { NotificationDelivery } from "../../../db/schema/notification-deliveries";

/**
 * Context supplied to a channel-specific delivery handler.
 *
 * The handler receives persisted, validated data rather than trusting
 * arbitrary information from a BullMQ job.
 */
export interface NotificationDeliveryContext {
  outboxEvent: OutboxEvent;
  delivery: NotificationDelivery;
  notification: Notification | null;
}

/**
 * Possible outcomes of an external or channel-specific delivery attempt.
 *
 * Important:
 * - accepted: the transport accepted the operation.
 * - delivered: the channel provided a reliable delivery confirmation.
 * - transient_failure: the handler knows retrying is safe and potentially useful.
 * - ambiguous: the handler cannot establish whether the action succeeded.
 */
export type NotificationDeliveryHandlerOutcome =
  | "accepted"
  | "delivered"
  | "transient_failure"
  | "permanent_failure"
  | "ambiguous"
  | "suppressed";

/**
 * Result returned by a channel handler.
 *
 * Error codes must be sanitized identifiers, not raw provider responses
 * containing addresses, message bodies or other sensitive information.
 */
export interface NotificationDeliveryHandlerResult {
  outcome: NotificationDeliveryHandlerOutcome;

  errorCode?: string | null;
  providerResponseCode?: string | null;
  providerMessageId?: string | null;

  acceptedAt?: Date;
  confirmedDeliveredAt?: Date;
}

/**
 * Implement this interface for each supported channel.
 *
 * A handler should return a structured result for expected transport
 * failures instead of throwing arbitrary provider errors.
 *
 * Unexpected exceptions are treated as ambiguous outcomes by the
 * delivery service because an external action may already have occurred.
 */
export interface NotificationDeliveryHandler {
  readonly channel: NotificationDeliveryContext["delivery"]["channel"];

  deliver(
    context: NotificationDeliveryContext,
  ): Promise<NotificationDeliveryHandlerResult>;
}
