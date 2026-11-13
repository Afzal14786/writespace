import type { DomainEventName } from "../domain/event-name";

/**
 * Identifies the business object associated with an event.
 *
 * Examples:
 * - { type: "CONTENT_ITEM", id: "<content-item-id>" }
 * - { type: "USER", id: "<user-id>" }
 *
 * Aggregate identifiers are represented as strings because the event
 * envelope is independent of the underlying database column type.
 */
export interface EventAggregate {
  type: string;
  id: string;
}

/**
 * Cross-cutting metadata used for tracing and diagnostics.
 *
 * Avoid putting secrets, authentication tokens, OTP values, or unnecessary
 * personal information in event metadata. It may be copied into logs or
 * queue payloads by later infrastructure.
 */
export type EventMetadata = Record<string, unknown>;

/**
 * Standard event envelope used after an event has been assigned its
 * persistent identity.
 *
 * eventId is the stable identity shared by the outbox row, queue job, and
 * downstream consumer. It must not be regenerated when retrying delivery.
 */
export interface DomainEventEnvelope<
  TName extends DomainEventName = DomainEventName,
  TPayload = unknown,
> {
  eventId: string;
  eventName: TName;
  eventVersion: number;
  producer: string;

  occurredAt: string;

  actorId: string | null;
  aggregate: EventAggregate | null;

  correlationId: string | null;
  causationId: string | null;

  payload: TPayload;
  metadata: EventMetadata;
}

/**
 * Input accepted when a domain module records an event in the outbox.
 *
 * eventId and occurredAt can be assigned by the event-publishing layer.
 * A caller may provide occurredAt when it needs to preserve the actual
 * business-operation timestamp.
 */
export interface DomainEventInput<
  TName extends DomainEventName = DomainEventName,
  TPayload = unknown,
> {
  eventName: TName;
  eventVersion?: number;
  producer: string;

  occurredAt?: Date;

  actorId?: string | null;
  aggregate?: EventAggregate | null;

  correlationId?: string | null;
  causationId?: string | null;

  payload: TPayload;
  metadata?: EventMetadata;
}
