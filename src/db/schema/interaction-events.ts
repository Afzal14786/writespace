import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./users";

/** Events emitted by interaction operations and consumed by downstream logic. */
export const interactionEventTypeEnum = pgEnum("interaction_event_type", [
  "reaction.added",
  "reaction.changed",
  "reaction.removed",
  "follow.created",
  "follow.removed",
  "save.created",
  "save.removed",
  "share.created",
]);

/**
 * Polymorphic target category for an event.
 *
 * `CONTENT_ITEM` replaces `POST`; this covers both Posts and Articles.
 * targetId intentionally has no FK because it can refer to a content item,
 * comment, or user. The publisher/service that creates an event validates
 * the target before persisting the event.
 */
export const interactionEventTargetTypeEnum = pgEnum(
  "interaction_event_target_type",
  ["CONTENT_ITEM", "COMMENT", "USER"],
);

export const interactionEvents = pgTable(
  "interaction_events",
  {
    id: serial("id").primaryKey(),

    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    eventType: interactionEventTypeEnum("event_type").notNull(),
    targetType: interactionEventTargetTypeEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),

    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("interaction_events_actor_created_idx").on(
      table.actorId,
      table.createdAt,
    ),
    index("interaction_events_target_created_idx").on(
      table.targetType,
      table.targetId,
      table.createdAt,
    ),
    index("interaction_events_type_created_idx").on(
      table.eventType,
      table.createdAt,
    ),
  ],
);

export type InteractionEvent = typeof interactionEvents.$inferSelect;
export type NewInteractionEvent = typeof interactionEvents.$inferInsert;
