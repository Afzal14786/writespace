import type { DomainEventName } from "./event-name";

export const NOTIFICATION_POLICY_VERSION = "social-notification-policy-v1";

export type NotificationPolicyCategory =
  | "social"
  | "content"
  | "security"
  | "chat"
  | "platform";

export type NotificationPolicyPriority = "critical" | "high" | "normal" | "low";

export type NotificationPolicyChannel = "in_app" | "email" | "browser_push";

export type NotificationClassification =
  | "mandatory_security"
  | "required_system"
  | "optional"
  | "conditional";

export interface NotificationChannelPolicy {
  /**
   * Whether the event catalogue permits this channel for the event.
   */
  readonly permitted: boolean;

  /**
   * Whether the channel is implemented and can currently process work.
   */
  readonly available: boolean;

  /**
   * Effective default when the user has no preference override.
   */
  readonly enabledByDefault: boolean;

  /**
   * Whether the user may change this channel through preferences.
   */
  readonly preferenceControlled: boolean;
}

export interface NotificationEventPolicy {
  readonly category: NotificationPolicyCategory;
  readonly priority: NotificationPolicyPriority;
  readonly classification: NotificationClassification;

  readonly channels: Readonly<
    Record<NotificationPolicyChannel, NotificationChannelPolicy>
  >;
}

/**
 * Initial social policy shared by the currently supported social events.
 *
 * In-app notifications are enabled by default.
 * Optional social email is disabled by default.
 * Browser push is planned but not available in the current implementation.
 */
const socialActivityPolicy: NotificationEventPolicy = {
  category: "social",
  priority: "normal",
  classification: "optional",

  channels: {
    in_app: {
      permitted: true,
      available: true,
      enabledByDefault: true,
      preferenceControlled: true,
    },

    email: {
      permitted: false,
      available: true,
      enabledByDefault: false,
      preferenceControlled: false,
    },

    browser_push: {
      permitted: false,
      available: false,
      enabledByDefault: false,
      preferenceControlled: false,
    },
  },
};

/**
 * Version-controlled policy registry.
 *
 * Only events that currently produce user-facing notifications are listed.
 * Other registered domain events can still be valid and intentionally produce
 * no notification.
 */
const notificationPolicyRegistry: Partial<
  Record<DomainEventName, NotificationEventPolicy>
> = {
  "reaction.added": socialActivityPolicy,
  "follow.created": socialActivityPolicy,
  "comment.created": socialActivityPolicy,
  "comment.replied": socialActivityPolicy,
  "mention.created": socialActivityPolicy,
};

export function getNotificationPolicy(
  eventName: DomainEventName,
): NotificationEventPolicy | null {
  const policy: NotificationEventPolicy | undefined =
    notificationPolicyRegistry[eventName];

  return policy === undefined ? null : policy;
}

/**
 * Effective in-app preference policy exposed to the preference service
 * and API.
 *
 * Defaults are sourced from the event policy registry. User-specific
 * overrides remain in notification_preferences.
 */
export interface InAppPreferencePolicy {
  category: NotificationPolicyCategory;
  enabledByDefault: boolean;
  editable: boolean;
  required: boolean;
}

/**
 * Determine whether a category/channel can be changed by the user.
 *
 * Mandatory security and required system communications cannot be
 * disabled through ordinary notification preferences.
 */
function isInAppPreferenceEditable(policy: NotificationEventPolicy): boolean {
  const channel = policy.channels.in_app;

  return (
    channel.permitted &&
    channel.available &&
    channel.preferenceControlled &&
    policy.classification !== "mandatory_security" &&
    policy.classification !== "required_system"
  );
}

/**
 * Resolve the in-app preference policy for one domain event.
 *
 * Returns null when in-app delivery is not currently permitted or available.
 * The processor can use this to evaluate a particular event.
 */
export function getInAppPreferencePolicyForEvent(
  eventName: DomainEventName,
): InAppPreferencePolicy | null {
  const policy = getNotificationPolicy(eventName);

  if (!policy) {
    return null;
  }

  const channel = policy.channels.in_app;

  if (!channel.permitted || !channel.available) {
    return null;
  }

  const editable = isInAppPreferenceEditable(policy);

  return {
    category: policy.category,
    enabledByDefault: channel.enabledByDefault,
    editable,
    required: !editable,
  };
}

/**
 * Build the supported in-app preference catalogue.
 *
 * Categories are discovered from registered notification-producing events,
 * rather than maintained as a separate hardcoded frontend list.
 *
 * Events sharing a category must use the same in-app default because
 * the user controls that category through one preference setting.
 */
export function getInAppPreferencePolicies(): InAppPreferencePolicy[] {
  const policiesByCategory = new Map<
    NotificationPolicyCategory,
    NotificationEventPolicy[]
  >();

  for (const policy of Object.values(notificationPolicyRegistry)) {
    if (!policy) {
      continue;
    }

    const channel = policy.channels.in_app;

    if (!channel.permitted || !channel.available) {
      continue;
    }

    const categoryPolicies = policiesByCategory.get(policy.category) ?? [];

    categoryPolicies.push(policy);
    policiesByCategory.set(policy.category, categoryPolicies);
  }

  return Array.from(policiesByCategory.entries())
    .map(([category, policies]) => {
      const defaults = new Set(
        policies.map((policy) => policy.channels.in_app.enabledByDefault),
      );

      if (defaults.size !== 1) {
        throw new Error(
          `Conflicting in-app preference defaults for category "${category}".`,
        );
      }

      const editable = policies.every(isInAppPreferenceEditable);

      return {
        category,
        enabledByDefault: policies[0]!.channels.in_app.enabledByDefault,
        editable,
        required: !editable,
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category));
}
