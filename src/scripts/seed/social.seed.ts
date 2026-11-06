import { asc, eq } from "drizzle-orm";

import type { SeedTransaction } from "./seed-types";

import {
  articles,
  contentItems,
  contentMentions,
  follows,
  interactionEvents,
  posts,
  users,
} from "../../db/schema";

import type { ContentDocument } from "../../db/schema/content-document";
import type { NewInteractionEvent } from "../../db/schema/interaction-events";

export async function seedSocialData(tx: SeedTransaction) {
  const userRows = await tx
    .select({
      id: users.id,
    })
    .from(users)
    .orderBy(asc(users.createdAt), asc(users.id));

  if (userRows.length < 4) {
    throw new Error(
      `Social seeding requires at least 4 users. Found ${userRows.length}.`,
    );
  }

  const publishedContent = await tx
    .select({
      id: contentItems.id,
      authorId: contentItems.authorId,
    })
    .from(contentItems)
    .where(eq(contentItems.status, "published"))
    .orderBy(asc(contentItems.createdAt), asc(contentItems.id));

  if (publishedContent.length === 0) {
    throw new Error(
      "No published content found. Run the content seed before social seeding.",
    );
  }

  // Create three outgoing follows for every user.
  // The cyclic offsets avoid self-follows and duplicate pairs.
  const followRows = userRows.flatMap((user, index) =>
    [1, 2, 3].map((offset) => ({
      followerId: user.id,
      followingId: userRows[(index + offset) % userRows.length].id,
    })),
  );

  await tx.insert(follows).values(followRows).onConflictDoNothing();

  // Only persist mentions that actually exist in the content documents.
  const publishedContentIds = new Set(publishedContent.map((item) => item.id));

  const knownUserIds = new Set(userRows.map((user) => user.id));
  const mentionRows = new Map<
    string,
    { contentItemId: string; mentionedUserId: string }
  >();

  const collectMentions = (
    contentItemId: string,
    document: ContentDocument,
  ) => {
    if (!publishedContentIds.has(contentItemId)) {
      return;
    }

    for (const block of document.blocks) {
      if (block.type !== "paragraph") {
        continue;
      }

      for (const node of block.children) {
        if (node.type !== "mention") {
          continue;
        }

        if (!knownUserIds.has(node.userId)) {
          throw new Error(
            `Content ${contentItemId} mentions an unknown user: ${node.userId}`,
          );
        }

        const key = `${contentItemId}:${node.userId}`;

        mentionRows.set(key, {
          contentItemId,
          mentionedUserId: node.userId,
        });
      }
    }
  };

  const postDocuments = await tx
    .select({
      id: posts.id,
      contentDocument: posts.contentDocument,
    })
    .from(posts);

  for (const post of postDocuments) {
    collectMentions(post.id, post.contentDocument);
  }

  const articleDocuments = await tx
    .select({
      id: articles.id,
      contentDocument: articles.contentDocument,
    })
    .from(articles);

  for (const article of articleDocuments) {
    collectMentions(article.id, article.contentDocument);
  }

  const mentionValues = Array.from(mentionRows.values());

  if (mentionValues.length > 0) {
    await tx
      .insert(contentMentions)
      .values(mentionValues)
      .onConflictDoNothing();
  }

  // Record follow events for downstream activity/notification processing.
  const followEventRows: NewInteractionEvent[] = followRows.map((follow) => ({
    actorId: follow.followerId,
    eventType: "follow.created",
    targetType: "USER",
    targetId: follow.followingId,
    metadata: {
      followingId: follow.followingId,
    },
  }));

  if (followEventRows.length > 0) {
    await tx.insert(interactionEvents).values(followEventRows);
  }

  return {
    follows: followRows.length,
    mentions: mentionValues.length,
    followEvents: followEventRows.length,
  };
}
