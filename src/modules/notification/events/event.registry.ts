import { z } from "zod";

import { HTTP_STATUS } from "@shared/constants/http-codes";
import { AppError } from "@shared/utils/app.error";

import type { DomainEventName } from "../domain/event-name";

import {
  mentionCreatedEventPayloadSchema,
  commentRepliedEventPayloadSchema,
  commentCreatedEventPayloadSchema,
  followEventPayloadSchema,
  reactionEventPayloadSchema,
  saveEventPayloadSchema,
  shareEventPayloadSchema,
} from "./event.schemas";

/**
 * Defines the supported payload version and validator for an event.
 */
interface EventDefinition {
  version: number;
  payloadSchema: z.ZodType;
}

/**
 * Registry of event contracts currently supported by this application.
 *
 * Adding a new event requires:
 * 1. Adding its name to DOMAIN_EVENT_NAMES.
 * 2. Defining its payload schema.
 * 3. Registering its supported version here.
 * 4. Implementing the consumer behaviour where required.
 */
export const eventRegistry = {
  "reaction.added": {
    version: 1,
    payloadSchema: reactionEventPayloadSchema,
  },

  "reaction.changed": {
    version: 1,
    payloadSchema: reactionEventPayloadSchema,
  },

  "reaction.removed": {
    version: 1,
    payloadSchema: reactionEventPayloadSchema,
  },

  "follow.created": {
    version: 1,
    payloadSchema: followEventPayloadSchema,
  },

  "follow.removed": {
    version: 1,
    payloadSchema: followEventPayloadSchema,
  },

  "save.created": {
    version: 1,
    payloadSchema: saveEventPayloadSchema,
  },

  "save.removed": {
    version: 1,
    payloadSchema: saveEventPayloadSchema,
  },

  "share.created": {
    version: 1,
    payloadSchema: shareEventPayloadSchema,
  },
  "comment.created": {
    version: 1,
    payloadSchema: commentCreatedEventPayloadSchema,
  },

  "comment.replied": {
    version: 1,
    payloadSchema: commentRepliedEventPayloadSchema,
  },

  "mention.created": {
    version: 1,
    payloadSchema: mentionCreatedEventPayloadSchema,
  },
} satisfies Record<DomainEventName, EventDefinition>;

/**
 * Maps each registered event name to the payload type inferred from
 * its registered Zod schema.
 */
export type EventPayloadMap = {
  [TName in DomainEventName]: z.infer<
    (typeof eventRegistry)[TName]["payloadSchema"]
  >;
};

/**
 * Returns the currently supported version of an event.
 */
export function getEventVersion(eventName: DomainEventName): number {
  return eventRegistry[eventName].version;
}

/**
 * Validates an event payload against its registered schema and version.
 *
 * Unsupported versions are permanent compatibility errors. Invalid
 * payloads throw ZodError; the event processor translates those into
 * AppError at its application boundary.
 */
export function parseEventPayload<TName extends DomainEventName>(
  eventName: TName,
  eventVersion: number,
  payload: unknown,
): EventPayloadMap[TName] {
  const definition = eventRegistry[eventName];

  if (eventVersion !== definition.version) {
    throw new AppError(
      HTTP_STATUS.UNPROCESSABLE_ENTITY,
      `Unsupported version ${eventVersion} for event "${eventName}". ` +
        `The currently supported version is ${definition.version}.`,
    );
  }

  return definition.payloadSchema.parse(payload) as EventPayloadMap[TName];
}
