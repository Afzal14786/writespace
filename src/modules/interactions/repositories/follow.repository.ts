import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../../../db";
import { follows, users } from "../../../db/schema";

export class FollowRepository {
  async findFollow(followerId: string, followingId: string) {
    const result = await db
      .select({
        followerId: follows.followerId,
        followingId: follows.followingId,
        createdAt: follows.createdAt,
      })
      .from(follows)
      .where(
        and(
          eq(follows.followerId, followerId),
          eq(follows.followingId, followingId),
        ),
      )
      .limit(1);

    return result[0] ?? null;
  }

  async createFollow(followerId: string, followingId: string) {
    return db.transaction(async (tx) => {
      /*
       * Lock both user rows in a consistent order before modifying
       * the relationship or user counters.
       *
       * This coordinates explicit follow operations with the legacy
       * toggle operation and reduces the risk of concurrent mutations.
       */
      await tx
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.id, [followerId, followingId]))
        .orderBy(asc(users.id))
        .for("update");

      const inserted = await tx
        .insert(follows)
        .values({
          followerId,
          followingId,
        })
        .onConflictDoNothing({
          target: [follows.followerId, follows.followingId],
        })
        .returning({
          followerId: follows.followerId,
          followingId: follows.followingId,
          createdAt: follows.createdAt,
        });

      // An existing relationship must not increment counters again.
      if (inserted.length === 0) {
        return null;
      }

      await tx
        .update(users)
        .set({
          totalFollowing: sql`
            ${users.totalFollowing}
            + CASE
                WHEN ${users.id} = ${followerId} THEN 1
                ELSE 0
              END
          `,
          totalFollowers: sql`
            ${users.totalFollowers}
            + CASE
                WHEN ${users.id} = ${followingId} THEN 1
                ELSE 0
              END
          `,
        })
        .where(inArray(users.id, [followerId, followingId]));

      return inserted[0];
    });
  }

  async deleteFollow(followerId: string, followingId: string) {
    return db.transaction(async (tx) => {
      /*
       * Use the same locking order as createFollow() so concurrent
       * follow, unfollow, and toggle operations coordinate consistently.
       */
      await tx
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.id, [followerId, followingId]))
        .orderBy(asc(users.id))
        .for("update");

      const deleted = await tx
        .delete(follows)
        .where(
          and(
            eq(follows.followerId, followerId),
            eq(follows.followingId, followingId),
          ),
        )
        .returning({
          followerId: follows.followerId,
          followingId: follows.followingId,
          createdAt: follows.createdAt,
        });

      // No existing relationship means no counter changes are necessary.
      if (deleted.length === 0) {
        return null;
      }

      await tx
        .update(users)
        .set({
          totalFollowing: sql`
            ${users.totalFollowing}
            - CASE
                WHEN ${users.id} = ${followerId} THEN 1
                ELSE 0
              END
          `,
          totalFollowers: sql`
            ${users.totalFollowers}
            - CASE
                WHEN ${users.id} = ${followingId} THEN 1
                ELSE 0
              END
          `,
        })
        .where(inArray(users.id, [followerId, followingId]));

      return deleted[0];
    });
  }

  /**
   * Atomically toggles a follow relationship.
   *
   * Both user rows are locked in a consistent order before checking
   * or modifying the relationship.
   *
   * The relationship change and both counter updates happen within
   * the same database transaction.
   *
   * This prevents concurrent requests through the explicit follow
   * endpoints and legacy toggle endpoint from racing with each other.
   */
  async toggleFollow(followerId: string, followingId: string) {
    return db.transaction(async (tx) => {
      // Coordinate with createFollow() and deleteFollow().
      await tx
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.id, [followerId, followingId]))
        .orderBy(asc(users.id))
        .for("update");

      // If a relationship exists, remove it.
      const deleted = await tx
        .delete(follows)
        .where(
          and(
            eq(follows.followerId, followerId),
            eq(follows.followingId, followingId),
          ),
        )
        .returning({
          followerId: follows.followerId,
          followingId: follows.followingId,
        });

      if (deleted.length > 0) {
        // Decrement counters only when a relationship was actually deleted.
        await tx
          .update(users)
          .set({
            totalFollowing: sql`
              ${users.totalFollowing}
              - CASE
                  WHEN ${users.id} = ${followerId} THEN 1
                  ELSE 0
                END
            `,
            totalFollowers: sql`
              ${users.totalFollowers}
              - CASE
                  WHEN ${users.id} = ${followingId} THEN 1
                  ELSE 0
                END
            `,
          })
          .where(inArray(users.id, [followerId, followingId]));

        return {
          isFollowing: false,
          changed: true,
        };
      }

      // No relationship existed, so create one.
      const inserted = await tx
        .insert(follows)
        .values({
          followerId,
          followingId,
        })
        .onConflictDoNothing({
          target: [follows.followerId, follows.followingId],
        })
        .returning({
          followerId: follows.followerId,
          followingId: follows.followingId,
        });

      if (inserted.length > 0) {
        // Increment counters only when a new relationship was inserted.
        await tx
          .update(users)
          .set({
            totalFollowing: sql`
              ${users.totalFollowing}
              + CASE
                  WHEN ${users.id} = ${followerId} THEN 1
                  ELSE 0
                END
            `,
            totalFollowers: sql`
              ${users.totalFollowers}
              + CASE
                  WHEN ${users.id} = ${followingId} THEN 1
                  ELSE 0
                END
            `,
          })
          .where(inArray(users.id, [followerId, followingId]));

        return {
          isFollowing: true,
          changed: true,
        };
      }

      /*
       * Defensive fallback for a conflicting writer that did not follow
       * this repository's user-row locking convention.
       *
       * No counters or interaction events are generated because this
       * transaction did not change the relationship.
       */
      const existing = await tx
        .select({ followerId: follows.followerId })
        .from(follows)
        .where(
          and(
            eq(follows.followerId, followerId),
            eq(follows.followingId, followingId),
          ),
        )
        .limit(1);

      return {
        isFollowing: existing.length > 0,
        changed: false,
      };
    });
  }

  async isFollowing(followerId: string, followingId: string) {
    const result = await db
      .select({
        exists: sql<boolean>`true`,
      })
      .from(follows)
      .where(
        and(
          eq(follows.followerId, followerId),
          eq(follows.followingId, followingId),
        ),
      )
      .limit(1);

    return result.length > 0;
  }

  /**
   * Checks whether the target user exists before creating or removing
   * a follow relationship.
   *
   * This allows the service to return a proper 404 instead of exposing
   * a database foreign-key error to the API client.
   */
  async userExists(userId: string): Promise<boolean> {
    const result = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return result.length > 0;
  }
}

export const followRepository = new FollowRepository();
