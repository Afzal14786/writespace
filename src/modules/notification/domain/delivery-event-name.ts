/**
 * Internal event names used to dispatch notification-channel work.
 *
 * These are notification-system events, not product domain events.
 * They must not be added to DOMAIN_EVENT_NAMES or the domain event registry.
 */
export const NOTIFICATION_DELIVERY_REQUESTED_EVENT =
  "notification.delivery.requested" as const;
