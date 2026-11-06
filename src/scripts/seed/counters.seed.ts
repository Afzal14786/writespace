import { count, eq, isNotNull, sum } from "drizzle-orm";

import type { SeedTransaction } from "./seed-types";

import {
  commentReactions,
  comments,
  contentItems,
  contentReactions,
  contentShares,
  follows,
  users,
} from "../../db/schema";

export async function seedCounters(tx: SeedTransaction) {
  // 1. Aggregate authored content and read counts.

  const userContentStats = await tx
    .select({
      authorId: contentItems.authorId,
      totalPosts: count(),
      totalReads: sum(contentItems.viewCount),
    })
    .from(contentItems)
    .groupBy(contentItems.authorId);

  const contentStatsByUser = new Map(
    userContentStats.map((row) => [
      row.authorId,
      {
        totalPosts: Number(row.totalPosts),
        totalReads: Number(row.totalReads ?? 0),
      },
    ]),
  );

  // 2. Aggregate follower and following counts.

  const followingStats = await tx
    .select({
      userId: follows.followerId,
      total: count(),
    })
    .from(follows)
    .groupBy(follows.followerId);

  const followerStats = await tx
    .select({
      userId: follows.followingId,
      total: count(),
    })
    .from(follows)
    .groupBy(follows.followingId);

  const followingByUser = new Map(
    followingStats.map((row) => [row.userId, Number(row.total)]),
  );

  const followersByUser = new Map(
    followerStats.map((row) => [row.userId, Number(row.total)]),
  );

  // 3. Aggregate content reactions, comments, and shares.

  const contentReactionStats = await tx
    .select({
      contentItemId: contentReactions.contentItemId,
      total: count(),
    })
    .from(contentReactions)
    .groupBy(contentReactions.contentItemId);

  const contentCommentStats = await tx
    .select({
      contentItemId: comments.contentItemId,
      total: count(),
    })
    .from(comments)
    .groupBy(comments.contentItemId);

  const contentShareStats = await tx
    .select({
      contentItemId: contentShares.contentItemId,
      total: count(),
    })
    .from(contentShares)
    .groupBy(contentShares.contentItemId);

  const reactionsByContent = new Map(
    contentReactionStats.map((row) => [row.contentItemId, Number(row.total)]),
  );

  const commentsByContent = new Map(
    contentCommentStats.map((row) => [row.contentItemId, Number(row.total)]),
  );

  const sharesByContent = new Map(
    contentShareStats.map((row) => [row.contentItemId, Number(row.total)]),
  );

  // 4. Aggregate comment reactions and direct replies.

  const commentReactionStats = await tx
    .select({
      commentId: commentReactions.commentId,
      total: count(),
    })
    .from(commentReactions)
    .groupBy(commentReactions.commentId);

  const commentReplyStats = await tx
    .select({
      parentCommentId: comments.parentCommentId,
      total: count(),
    })
    .from(comments)
    .where(isNotNull(comments.parentCommentId))
    .groupBy(comments.parentCommentId);

  const reactionsByComment = new Map(
    commentReactionStats.map((row) => [row.commentId, Number(row.total)]),
  );

  const repliesByComment = new Map<string, number>();

  for (const row of commentReplyStats) {
    if (row.parentCommentId !== null) {
      repliesByComment.set(row.parentCommentId, Number(row.total));
    }
  }

  // 5. Write user counters.

  const userRows = await tx
    .select({
      id: users.id,
    })
    .from(users);

  for (const user of userRows) {
    const contentStats = contentStatsByUser.get(user.id);

    await tx
      .update(users)
      .set({
        totalPosts: contentStats?.totalPosts ?? 0,
        totalReads: contentStats?.totalReads ?? 0,
        totalFollowers: followersByUser.get(user.id) ?? 0,
        totalFollowing: followingByUser.get(user.id) ?? 0,
      })
      .where(eq(users.id, user.id));
  }

  // 6. Write content item counters.

  const contentRows = await tx
    .select({
      id: contentItems.id,
    })
    .from(contentItems);

  for (const content of contentRows) {
    await tx
      .update(contentItems)
      .set({
        reactionCount: reactionsByContent.get(content.id) ?? 0,
        commentCount: commentsByContent.get(content.id) ?? 0,
        shareCount: sharesByContent.get(content.id) ?? 0,
      })
      .where(eq(contentItems.id, content.id));
  }

  // 7. Write comment counters.

  const commentRows = await tx
    .select({
      id: comments.id,
    })
    .from(comments);

  for (const comment of commentRows) {
    await tx
      .update(comments)
      .set({
        reactionCount: reactionsByComment.get(comment.id) ?? 0,
        replyCount: repliesByComment.get(comment.id) ?? 0,
      })
      .where(eq(comments.id, comment.id));
  }

  return {
    users: userRows.length,
    contentItems: contentRows.length,
    comments: commentRows.length,
  };
}
