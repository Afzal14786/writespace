import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import type { DatabaseTransaction } from "../../../db";

import { HTTP_STATUS } from "@shared/constants/http-codes";
import { AppError } from "@shared/utils/app.error";

import { notificationGroupEvents } from "../../../db/schema/notification-group-events";
import { notificationGroups } from "../../../db/schema/notification-groups";
import {
  notifications,
  type NewNotification,
  type Notification,
} from "../../../db/schema/notifications";

import { users } from "../../../db/schema/users";

import {
  GROUPED_NOTIFICATION_ACTOR_DISPLAY_LIMIT,
  POST_REACTION_ACTIVITY_TYPE,
} from "../domain/notification-grouping.policy";

export interface AddPostReactionToGroupInput {
  recipientUserId: string;
  actorUserId: string;
  sourceEventId: string;
  occurredAt: Date;

  groupingKey: string;
  groupingWindowStart: Date;

  // The repository supplies groupId and the group-level dedupe key.
  notification: Omit<NewNotification, "groupId" | "dedupeKey">;
}

export interface GroupedPostReactionResult {
  notification: Notification;
  groupId: string;
  groupCount: number;
  outcome: "created" | "updated" | "duplicate";
}

/**
 * Database operations for grouped notification activity.
 *
 * Every operation accepts the caller's transaction so that group
 * membership, aggregate counters and inbox presentation commit together.
 */
export class NotificationGroupRepository {
  /**
   * Find and lock the active group for one recipient and event-time bucket.
   */
  private async findActiveGroup(
    transaction: DatabaseTransaction,
    input: AddPostReactionToGroupInput,
  ) {
    const [group] = await transaction
      .select()
      .from(notificationGroups)
      .where(
        and(
          eq(notificationGroups.recipientUserId, input.recipientUserId),
          eq(notificationGroups.groupingKey, input.groupingKey),
          eq(notificationGroups.groupingWindowStart, input.groupingWindowStart),
          eq(notificationGroups.status, "active"),
        ),
      )
      .for("update")
      .limit(1);

    return group ?? null;
  }

  /**
   * Find the active inbox presentation belonging to a group.
   *
   * A dismissed or soft-deleted presentation must not prevent future
   * activity from creating a new active group.
   */
  private async findActivePresentation(
    transaction: DatabaseTransaction,
    groupId: string,
  ): Promise<Notification | null> {
    const [notification] = await transaction
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.groupId, groupId),
          eq(notifications.status, "active"),
          isNull(notifications.deletedAt),
        ),
      )
      .for("update")
      .limit(1);

    return notification ?? null;
  }

  /**
   * Resolve the three most recently active distinct actors in a group.
   *
   * Membership rows retain event identity. The actor preview is only
   * presentation data and does not determine the aggregate event count.
   *
   * Deleted users are naturally excluded because their membership
   * actor_user_id is set to NULL by the database.
   */
  private async findGroupActorPreviews(
    transaction: DatabaseTransaction,
    groupId: string,
  ) {
    const rankedMemberships = transaction
      .select({
        actorUserId: notificationGroupEvents.actorUserId,
        occurredAt: notificationGroupEvents.occurredAt,
        rowNumber: sql<number>`
          ROW_NUMBER() OVER (
            PARTITION BY ${notificationGroupEvents.actorUserId}
            ORDER BY ${notificationGroupEvents.occurredAt} DESC
          )
        `.as("row_number"),
      })
      .from(notificationGroupEvents)
      .where(
        and(
          eq(notificationGroupEvents.groupId, groupId),
          isNotNull(notificationGroupEvents.actorUserId),
        ),
      )
      .as("ranked_memberships");

    return transaction
      .select({
        id: users.id,
        username: users.username,
        displayName: users.fullname,
      })
      .from(rankedMemberships)
      .innerJoin(users, eq(rankedMemberships.actorUserId, users.id))
      .where(eq(rankedMemberships.rowNumber, 1))
      .orderBy(desc(rankedMemberships.occurredAt))
      .limit(GROUPED_NOTIFICATION_ACTOR_DISPLAY_LIMIT);
  }

  /**
   * Preserve the original event presentation fields while adding
   * the current grouped-activity actor preview.
   */
  private buildGroupedPresentationData(
    presentationData: Record<string, unknown>,
    actors: Array<{
      id: string;
      username: string;
      displayName: string | null;
    }>,
  ): Record<string, unknown> {
    return {
      ...presentationData,
      groupedActivity: {
        activityType: POST_REACTION_ACTIVITY_TYPE,
        actors,
      },
    };
  }

  /**
   * Close a group whose inbox presentation is no longer active.
   *
   * Closing it releases the partial unique index so that new activity
   * can receive a fresh group in the same deterministic time bucket.
   */
  private async closeGroup(
    transaction: DatabaseTransaction,
    groupId: string,
  ): Promise<void> {
    await transaction
      .update(notificationGroups)
      .set({
        status: "closed",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(notificationGroups.id, groupId),
          eq(notificationGroups.status, "active"),
        ),
      );
  }

  /**
   * Create a new group and its first inbox notification.
   *
   * Initial group_count is one because the first source event is
   * represented by this new group. Its membership is recorded in
   * the same transaction.
   */
  private async createGroupWithNotification(
    transaction: DatabaseTransaction,
    input: AddPostReactionToGroupInput,
    group: typeof notificationGroups.$inferSelect,
  ): Promise<GroupedPostReactionResult> {
    const [notification] = await transaction
      .insert(notifications)
      .values({
        ...input.notification,
        groupId: group.id,
        dedupeKey: `group:${group.id}`,
      })
      .returning();

    if (!notification) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Failed to create grouped notification.",
      );
    }

    const [membership] = await transaction
      .insert(notificationGroupEvents)
      .values({
        groupId: group.id,
        notificationId: notification.id,
        sourceEventId: input.sourceEventId,
        actorUserId: input.actorUserId,
        occurredAt: input.occurredAt,
      })
      .onConflictDoNothing()
      .returning({
        id: notificationGroupEvents.id,
      });

    if (!membership) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Failed to record the initial grouped event.",
      );
    }

    const actors = await this.findGroupActorPreviews(transaction, group.id);

    const [updatedNotification] = await transaction
      .update(notifications)
      .set({
        presentationData: this.buildGroupedPresentationData(
          notification.presentationData,
          actors,
        ),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(notifications.id, notification.id),
          eq(notifications.groupId, group.id),
          eq(notifications.status, "active"),
          isNull(notifications.deletedAt),
        ),
      )
      .returning();

    if (!updatedNotification) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Failed to update grouped notification presentation.",
      );
    }

    return {
      notification: updatedNotification,
      groupId: group.id,
      groupCount: 1,
      outcome: "created",
    };
  }

  /**
   * Attach another distinct source event to an existing group.
   *
   * The membership insert happens before the counter update. A duplicate
   * membership therefore cannot increment the aggregate count.
   */
  private async appendToExistingGroup(
    transaction: DatabaseTransaction,
    input: AddPostReactionToGroupInput,
    group: typeof notificationGroups.$inferSelect,
    notification: Notification,
  ): Promise<GroupedPostReactionResult> {
    const [membership] = await transaction
      .insert(notificationGroupEvents)
      .values({
        groupId: group.id,
        notificationId: notification.id,
        sourceEventId: input.sourceEventId,
        actorUserId: input.actorUserId,
        occurredAt: input.occurredAt,
      })
      .onConflictDoNothing()
      .returning({
        id: notificationGroupEvents.id,
      });

    // A source event already attached to this group must not be counted twice.
    if (!membership) {
      return {
        notification,
        groupId: group.id,
        groupCount: group.groupCount,
        outcome: "duplicate",
      };
    }

    const now = new Date();

    // Only a newly inserted membership is allowed to increment group_count.
    const [updatedGroup] = await transaction
      .update(notificationGroups)
      .set({
        groupCount: sql`${notificationGroups.groupCount} + 1`,
        firstActivityAt: sql`LEAST(
          ${notificationGroups.firstActivityAt},
          ${input.occurredAt}
        )`,
        lastActivityAt: sql`GREATEST(
          ${notificationGroups.lastActivityAt},
          ${input.occurredAt}
        )`,
        updatedAt: now,
      })
      .where(eq(notificationGroups.id, group.id))
      .returning({
        groupCount: notificationGroups.groupCount,
      });

    if (!updatedGroup) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Failed to update notification group count.",
      );
    }

    const actors = await this.findGroupActorPreviews(transaction, group.id);

    // Keep the inbox item's update timestamp aligned with its group update.
    const [updatedNotification] = await transaction
      .update(notifications)
      .set({
        presentationData: this.buildGroupedPresentationData(
          notification.presentationData,
          actors,
        ),
        updatedAt: now,
      })
      .where(
        and(
          eq(notifications.id, notification.id),
          eq(notifications.groupId, group.id),
          eq(notifications.status, "active"),
          isNull(notifications.deletedAt),
        ),
      )
      .returning();

    if (!updatedNotification) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Failed to update grouped inbox notification.",
      );
    }

    return {
      notification: updatedNotification,
      groupId: group.id,
      groupCount: updatedGroup.groupCount,
      outcome: "updated",
    };
  }

  /**
   * Add one post-reaction event to its deterministic group.
   *
   * The unique active-group index protects against concurrent group
   * creation. When another transaction wins that race, we retry the
   * lookup and append to the group it created.
   */
  public async addPostReactionToGroup(
    transaction: DatabaseTransaction,
    input: AddPostReactionToGroupInput,
  ): Promise<GroupedPostReactionResult> {
    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const existingGroup = await this.findActiveGroup(transaction, input);

      if (existingGroup) {
        const existingNotification = await this.findActivePresentation(
          transaction,
          existingGroup.id,
        );

        if (!existingNotification) {
          // Do not append new activity to a dismissed or deleted inbox item.
          await this.closeGroup(transaction, existingGroup.id);
          continue;
        }

        return this.appendToExistingGroup(
          transaction,
          input,
          existingGroup,
          existingNotification,
        );
      }

      const [newGroup] = await transaction
        .insert(notificationGroups)
        .values({
          recipientUserId: input.recipientUserId,
          groupingKey: input.groupingKey,
          groupingWindowStart: input.groupingWindowStart,
          activityType: POST_REACTION_ACTIVITY_TYPE,
          resourceType: "content_item",
          resourceId: input.notification.resourceId ?? null,
          groupCount: 1,
          firstActivityAt: input.occurredAt,
          lastActivityAt: input.occurredAt,
          status: "active",
        })
        .onConflictDoNothing()
        .returning();

      if (newGroup) {
        return this.createGroupWithNotification(transaction, input, newGroup);
      }

      // Another worker may have created the same active group concurrently.
      // The next iteration will lock and use that committed group.
    }

    throw new AppError(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      "Unable to create or update notification group after concurrent retries.",
    );
  }
}

export const notificationGroupRepository = new NotificationGroupRepository();
