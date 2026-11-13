/**
 * Canonical names for events currently supported by the notification
 * event pipeline.
 *
 * These names are based on the interaction event vocabulary already
 * present in src/db/schema/interaction-events.ts.
 *
 * Keep this list independent from PostgreSQL enums. New event names should
 * be introduced here together with their payload schema and registry entry.
 */
export const DOMAIN_EVENT_NAMES = [
  "reaction.added",
  "reaction.changed",
  "reaction.removed",
  "follow.created",
  "follow.removed",
  "save.created",
  "save.removed",
  "share.created",
  "comment.created",
  "comment.replied",
  "mention.created",
] as const;

export type DomainEventName = (typeof DOMAIN_EVENT_NAMES)[number];

/**
 * Runtime guard for values arriving from persisted rows, queues, or other
 * boundaries where TypeScript types are not available.
 */
const domainEventNameSet: ReadonlySet<string> = new Set(DOMAIN_EVENT_NAMES);

export function isDomainEventName(value: unknown): value is DomainEventName {
  return typeof value === "string" && domainEventNameSet.has(value);
}
