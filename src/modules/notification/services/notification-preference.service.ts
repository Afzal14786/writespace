import { db } from "../../../db";

import { HTTP_STATUS } from "@shared/constants/http-codes";
import { AppError } from "@shared/utils/app.error";

import {
  getInAppPreferencePolicies,
  type InAppPreferencePolicy,
} from "../domain/notification-policy.registry";

import {
  notificationPreferenceRepository,
  type InAppPreferenceUpdate,
} from "../repositories/notification-preference.repository";

/**
 * Validated input for updating in-app notification preferences.
 */
export interface UpdateInAppPreferencesInput {
  updates: InAppPreferenceUpdate[];
}

/**
 * Effective preference returned to the API consumer.
 *
 * The frontend receives the effective value and its source so it does
 * not need to maintain a separate copy of backend policy defaults.
 */
export interface EffectiveInAppPreference {
  category: string;
  channel: "in_app";
  enabled: boolean;
  frequency: "immediate";
  source: "default" | "user_override";
  editable: boolean;
  required: boolean;
}

/**
 * User-facing notification preference operations.
 *
 * This service resolves policy defaults and stored user overrides.
 * It does not create notifications or modify historical inbox records.
 */
export class NotificationPreferenceService {
  /**
   * Combine the supported policy catalogue with stored user overrides.
   *
   * Categories without a stored preference inherit their default
   * from the notification policy registry.
   */
  private resolveEffectivePreferences(
    policies: InAppPreferencePolicy[],
    overrides: Array<{
      category: string;
      enabled: boolean;
    }>,
  ): EffectiveInAppPreference[] {
    const overrideByCategory = new Map(
      overrides.map((preference) => [preference.category, preference.enabled]),
    );

    return policies.map((policy) => {
      const hasOverride = overrideByCategory.has(policy.category);

      return {
        category: policy.category,
        channel: "in_app",
        enabled: hasOverride
          ? overrideByCategory.get(policy.category)!
          : policy.enabledByDefault,
        frequency: "immediate",
        source: hasOverride ? "user_override" : "default",
        editable: policy.editable,
        required: policy.required,
      };
    });
  }

  /**
   * Return effective preferences for the authenticated user.
   *
   * Only currently supported in-app categories are returned.
   */
  public async getPreferences(userId: string) {
    const policies = getInAppPreferencePolicies();

    const overrides =
      await notificationPreferenceRepository.findAllInAppOverrides(userId);

    return {
      preferences: this.resolveEffectivePreferences(policies, overrides),
    };
  }

  /**
   * Validate and persist a batch of in-app preference changes.
   *
   * The complete batch is validated before any database write occurs.
   * All changes are then committed in one transaction.
   */
  public async updatePreferences(
    userId: string,
    input: UpdateInAppPreferencesInput,
  ) {
    if (!Array.isArray(input.updates) || input.updates.length === 0) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "At least one preference update is required.",
      );
    }

    const policies = getInAppPreferencePolicies();

    const policyByCategory = new Map<string, InAppPreferencePolicy>(
      policies.map((policy) => [policy.category, policy]),
    );

    const seenCategories = new Set<string>();

    // Validate the entire request before entering the write transaction.
    const validatedUpdates: InAppPreferenceUpdate[] = input.updates.map(
      (update) => {
        const category = update.category.trim();

        if (!category) {
          throw new AppError(
            HTTP_STATUS.BAD_REQUEST,
            "Preference category must not be empty.",
          );
        }

        if (seenCategories.has(category)) {
          throw new AppError(
            HTTP_STATUS.BAD_REQUEST,
            `Duplicate preference category "${category}".`,
          );
        }

        seenCategories.add(category);

        const policy = policyByCategory.get(category);

        if (!policy) {
          throw new AppError(
            HTTP_STATUS.BAD_REQUEST,
            `Unsupported in-app notification category "${category}".`,
          );
        }

        if (!policy.editable) {
          throw new AppError(
            HTTP_STATUS.UNPROCESSABLE_ENTITY,
            `In-app notifications for category "${category}" cannot be disabled or changed.`,
          );
        }

        return {
          category,
          enabled: update.enabled,
        };
      },
    );

    // The repository performs one bulk upsert inside this transaction.
    // A failure rolls back the complete preference update batch.
    await db.transaction(async (transaction) => {
      await notificationPreferenceRepository.upsertInAppOverrides(
        transaction,
        userId,
        validatedUpdates,
      );
    });

    // Return the resulting effective state, including unchanged categories.
    return this.getPreferences(userId);
  }
}

export const notificationPreferenceService =
  new NotificationPreferenceService();
