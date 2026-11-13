import { and, asc, eq, sql } from "drizzle-orm";

import { db, type DatabaseTransaction } from "../../../db";

import {
  notificationPreferences,
  type NotificationPreference,
} from "../../../db/schema/notification-preferences";

export interface InAppPreferenceUpdate {
  category: string;
  enabled: boolean;
}

/**
 * Database operations for user notification preferences.
 *
 * Preferences are stored as overrides to the defaults maintained by
 * the notification policy registry.
 *
 * This repository currently exposes only the in-app channel.
 * Email and browser-push preferences will be integrated in their
 * respective implementation phases.
 */
export class NotificationPreferenceRepository {
  /**
   * Find a user's explicit in-app preference for one category.
   *
   * A null result means no override exists and the caller must resolve
   * the effective value from the notification policy registry.
   */
  public async findInAppOverride(
    transaction: DatabaseTransaction,
    userId: string,
    category: string,
  ): Promise<boolean | null> {
    const [preference] = await transaction
      .select({
        enabled: notificationPreferences.enabled,
      })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.category, category),
          eq(notificationPreferences.channel, "in_app"),
        ),
      )
      .limit(1);

    return preference?.enabled ?? null;
  }

  /**
   * Retrieve all stored in-app preference overrides for one user.
   *
   * The policy registry supplies defaults for categories that do not
   * have a stored row, so we deliberately do not create default rows.
   */
  public async findAllInAppOverrides(
    userId: string,
  ): Promise<NotificationPreference[]> {
    return db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.channel, "in_app"),
        ),
      )
      .orderBy(asc(notificationPreferences.category));
  }

  /**
   * Insert or update multiple in-app preference overrides atomically.
   *
   * The composite primary key guarantees one preference per
   * user/category/channel combination.
   *
   * In-app frequency is always immediate. Digest frequencies belong
   * to the future digest implementation, not the persistent inbox.
   *
   * The caller is responsible for validating the complete update set
   * and ensuring that category names are unique before calling this method.
   */
  public async upsertInAppOverrides(
    transaction: DatabaseTransaction,
    userId: string,
    updates: InAppPreferenceUpdate[],
  ): Promise<NotificationPreference[]> {
    if (updates.length === 0) {
      return [];
    }

    const values = updates.map((update) => ({
      userId,
      category: update.category,
      channel: "in_app" as const,
      enabled: update.enabled,
      frequency: "immediate" as const,
    }));

    return transaction
      .insert(notificationPreferences)
      .values(values)
      .onConflictDoUpdate({
        target: [
          notificationPreferences.userId,
          notificationPreferences.category,
          notificationPreferences.channel,
        ],
        set: {
          enabled: sql`excluded.enabled`,
          frequency: sql`excluded.frequency`,
          updatedAt: sql`now()`,
        },
      })
      .returning();
  }
}

export const notificationPreferenceRepository =
  new NotificationPreferenceRepository();
