import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";

import type { SeedTransaction } from "./seed-types";

import {
  commentReactions,
  comments,
  contentItems,
  contentReactions,
  contentSaves,
  contentShares,
  interactionEvents,
  reactionTypes,
  users,
} from "../../db/schema";

import type { NewInteractionEvent } from "../../db/schema/interaction-events";

const COMMENT_TEXTS = [
  "This is a useful perspective. The practical trade-offs are worth thinking about.",
  "I have run into a similar situation. Keeping the implementation observable helped a lot.",
  "The explanation is clear, especially the production considerations. Thanks for sharing.",
  "Good breakdown. I would also consider how this behaves under heavier traffic.",
  "This is an interesting approach. I would like to explore these trade-offs further.",
  "The real-world examples make this much easier to understand.",
];

const SHARE_PLATFORMS = ["copy_link", "linkedin", "x"] as const;

export async function seedInteractionData(tx: SeedTransaction) {
  const userRows = await tx
    .select({
      id: users.id,
    })
    .from(users)
    .orderBy(asc(users.createdAt), asc(users.id));

  if (userRows.length < 7) {
    throw new Error(
      `Interaction seeding requires at least 7 users. Found ${userRows.length}.`,
    );
  }

  const publishedContent = await tx
    .select({
      id: contentItems.id,
      authorId: contentItems.authorId,
      createdAt: contentItems.createdAt,
      publishDate: contentItems.publishDate,
    })
    .from(contentItems)
    .where(eq(contentItems.status, "published"))
    .orderBy(asc(contentItems.createdAt), asc(contentItems.id));

  if (publishedContent.length === 0) {
    throw new Error(
      "No published content found. Run the content seed before interaction seeding.",
    );
  }

  const userIndexById = new Map(
    userRows.map((user, index) => [user.id, index]),
  );

  // Return a user relative to the content author's position.
  // Offsets are chosen to avoid making the author interact with their own content.
  const userForOffset = (authorId: string, offset: number) => {
    const authorIndex = userIndexById.get(authorId);

    if (authorIndex === undefined) {
      throw new Error(`Unknown content author: ${authorId}`);
    }

    return userRows[(authorIndex + offset) % userRows.length].id;
  };

  // 1. Comments: two top-level comments per item.

  const rootCommentRows = publishedContent.flatMap((item, index) => {
    const baseDate = item.publishDate ?? item.createdAt;

    return [
      {
        id: randomUUID(),
        content: COMMENT_TEXTS[index % COMMENT_TEXTS.length],
        contentItemId: item.id,
        authorId: userForOffset(item.authorId, 1),
        createdAt: new Date(baseDate.getTime() + 60 * 60 * 1000),
      },
      {
        id: randomUUID(),
        content: COMMENT_TEXTS[(index + 2) % COMMENT_TEXTS.length],
        contentItemId: item.id,
        authorId: userForOffset(item.authorId, 2),
        createdAt: new Date(baseDate.getTime() + 80 * 60 * 1000),
      },
    ];
  });

  const insertedRootComments = await tx
    .insert(comments)
    .values(rootCommentRows)
    .returning({
      id: comments.id,
      contentItemId: comments.contentItemId,
      authorId: comments.authorId,
      createdAt: comments.createdAt,
    });

  // Keep one root comment per content item as the parent for its reply.
  const firstRootByContentId = new Map<
    string,
    (typeof insertedRootComments)[number]
  >();

  for (const comment of insertedRootComments) {
    if (!firstRootByContentId.has(comment.contentItemId)) {
      firstRootByContentId.set(comment.contentItemId, comment);
    }
  }

  // 2. Replies: one reply for every published item.

  const replyRows = publishedContent.map((item, index) => {
    const parentComment = firstRootByContentId.get(item.id);

    if (!parentComment) {
      throw new Error(
        `Could not find a root comment for content item ${item.id}.`,
      );
    }

    const baseDate = item.publishDate ?? item.createdAt;

    return {
      id: randomUUID(),
      content: COMMENT_TEXTS[(index + 4) % COMMENT_TEXTS.length],
      contentItemId: item.id,
      authorId: userForOffset(item.authorId, 3),
      parentCommentId: parentComment.id,
      createdAt: new Date(baseDate.getTime() + 2 * 60 * 60 * 1000),
    };
  });

  const insertedReplies = await tx
    .insert(comments)
    .values(replyRows)
    .returning({
      id: comments.id,
      contentItemId: comments.contentItemId,
      authorId: comments.authorId,
      createdAt: comments.createdAt,
    });

  const allComments = [...insertedRootComments, ...insertedReplies];

  // 3. Comment reactions: one reaction per comment.

  const commentReactionRows = allComments.map((comment, index) => ({
    commentId: comment.id,
    userId: userForOffset(comment.authorId, 1),
    reactionType: reactionTypes[index % reactionTypes.length],
    createdAt: new Date(comment.createdAt.getTime() + 10 * 60 * 1000),
  }));

  if (commentReactionRows.length > 0) {
    await tx.insert(commentReactions).values(commentReactionRows);
  }

  // 4. Content reactions: three per published item.

  const contentReactionRows: Array<{
    contentItemId: string;
    userId: string;
    reactionType: (typeof reactionTypes)[number];
    createdAt: Date;
  }> = [];

  const eventRows: NewInteractionEvent[] = [];

  for (const [index, item] of publishedContent.entries()) {
    const baseDate = item.publishDate ?? item.createdAt;

    for (const offset of [1, 2, 3]) {
      const userId = userForOffset(item.authorId, offset);
      const reactionType =
        reactionTypes[(index + offset) % reactionTypes.length];
      const createdAt = new Date(
        baseDate.getTime() + (3 + offset) * 60 * 60 * 1000,
      );

      contentReactionRows.push({
        contentItemId: item.id,
        userId,
        reactionType,
        createdAt,
      });

      eventRows.push({
        actorId: userId,
        eventType: "reaction.added",
        targetType: "CONTENT_ITEM",
        targetId: item.id,
        metadata: {
          reactionType,
        },
        createdAt,
      });
    }
  }

  if (contentReactionRows.length > 0) {
    await tx.insert(contentReactions).values(contentReactionRows);
  }

  // 5. Saves: two per published item.

  const saveRows = publishedContent.flatMap((item) => {
    const baseDate = item.publishDate ?? item.createdAt;

    return [4, 5].map((offset) => ({
      contentItemId: item.id,
      userId: userForOffset(item.authorId, offset),
      createdAt: new Date(baseDate.getTime() + (7 + offset) * 60 * 60 * 1000),
    }));
  });

  if (saveRows.length > 0) {
    await tx.insert(contentSaves).values(saveRows);

    for (const save of saveRows) {
      eventRows.push({
        actorId: save.userId,
        eventType: "save.created",
        targetType: "CONTENT_ITEM",
        targetId: save.contentItemId,
        metadata: {},
        createdAt: save.createdAt,
      });
    }
  }

  // 6. Shares: one per published item.

  const shareRows = publishedContent.map((item, index) => {
    const baseDate = item.publishDate ?? item.createdAt;

    return {
      userId: userForOffset(item.authorId, 6),
      contentItemId: item.id,
      platform: SHARE_PLATFORMS[index % SHARE_PLATFORMS.length],
      createdAt: new Date(baseDate.getTime() + 15 * 60 * 60 * 1000),
    };
  });

  if (shareRows.length > 0) {
    await tx.insert(contentShares).values(shareRows);

    for (const share of shareRows) {
      eventRows.push({
        actorId: share.userId,
        eventType: "share.created",
        targetType: "CONTENT_ITEM",
        targetId: share.contentItemId,
        metadata: {
          platform: share.platform,
        },
        createdAt: share.createdAt,
      });
    }
  }

  // Persist content reaction, save, and share activity events.
  if (eventRows.length > 0) {
    await tx.insert(interactionEvents).values(eventRows);
  }

  return {
    comments: allComments.length,
    commentReactions: commentReactionRows.length,
    contentReactions: contentReactionRows.length,
    saves: saveRows.length,
    shares: shareRows.length,
    interactionEvents: eventRows.length,
  };
}
