import { count } from "drizzle-orm";

import { db, pool } from "../../db";
import {
  articles,
  commentReactions,
  comments,
  contentItems,
  contentMentions,
  contentReactions,
  contentSaves,
  contentShares,
  follows,
  interactionEvents,
  notificationDeliveries,
  notifications,
  postMedia,
  posts,
  users,
} from "../../db/schema";

import { seedUsers } from "./users.seed";
import { seedContent } from "./content.seed";
import { seedSocialData } from "./social.seed";
import { seedInteractionData } from "./interactions.seed";
import { seedNotifications } from "./notifications.seed";
import { seedCounters } from "./counters.seed";

async function main() {
  try {
    const summary = await db.transaction(async (tx) => {
      // Avoid creating duplicate demo data on top of existing user records.
      const [existingUser] = await tx
        .select({
          id: users.id,
        })
        .from(users)
        .limit(1);

      if (existingUser) {
        throw new Error(
          "The users table is not empty. Seeding is intended for a clean local database. No seed records were inserted.",
        );
      }

      console.log("[seed] Creating demo users...");
      await seedUsers(tx);

      console.log("[seed] Creating Posts and Articles...");
      await seedContent(tx);

      console.log("[seed] Creating follows and mentions...");
      const social = await seedSocialData(tx);

      console.log("[seed] Creating comments and interactions...");
      const interactions = await seedInteractionData(tx);

      console.log("[seed] Creating notifications and deliveries...");
      const notificationSummary = await seedNotifications(tx);

      console.log("[seed] Synchronizing denormalized counters...");
      const counters = await seedCounters(tx);

      // Read final table counts from the same transaction.
      const [userCount] = await tx.select({ total: count() }).from(users);

      const [contentCount] = await tx
        .select({ total: count() })
        .from(contentItems);

      const [postCount] = await tx.select({ total: count() }).from(posts);

      const [articleCount] = await tx.select({ total: count() }).from(articles);

      const [mediaCount] = await tx.select({ total: count() }).from(postMedia);

      const [followCount] = await tx.select({ total: count() }).from(follows);

      const [mentionCount] = await tx
        .select({ total: count() })
        .from(contentMentions);

      const [commentCount] = await tx.select({ total: count() }).from(comments);

      const [contentReactionCount] = await tx
        .select({ total: count() })
        .from(contentReactions);

      const [commentReactionCount] = await tx
        .select({ total: count() })
        .from(commentReactions);

      const [saveCount] = await tx
        .select({ total: count() })
        .from(contentSaves);

      const [shareCount] = await tx
        .select({ total: count() })
        .from(contentShares);

      const [notificationCount] = await tx
        .select({ total: count() })
        .from(notifications);

      const [deliveryCount] = await tx
        .select({ total: count() })
        .from(notificationDeliveries);

      const [eventCount] = await tx
        .select({ total: count() })
        .from(interactionEvents);

      return {
        tables: {
          users: Number(userCount.total),
          contentItems: Number(contentCount.total),
          posts: Number(postCount.total),
          articles: Number(articleCount.total),
          postMedia: Number(mediaCount.total),
          follows: Number(followCount.total),
          contentMentions: Number(mentionCount.total),
          comments: Number(commentCount.total),
          contentReactions: Number(contentReactionCount.total),
          commentReactions: Number(commentReactionCount.total),
          contentSaves: Number(saveCount.total),
          contentShares: Number(shareCount.total),
          notifications: Number(notificationCount.total),
          notificationDeliveries: Number(deliveryCount.total),
          interactionEvents: Number(eventCount.total),
        },
        stages: {
          social,
          interactions,
          notifications: notificationSummary,
          counters,
        },
      };
    });

    console.log("\n[seed] Database seeding completed successfully.");
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error(
      "\n[seed] Database seeding failed. The transaction was rolled back.",
    );

    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }

    process.exitCode = 1;
  } finally {
    await pool.end().catch((error) => {
      console.error("[seed] Failed to close the database pool:", error);
    });
  }
}

void main();
