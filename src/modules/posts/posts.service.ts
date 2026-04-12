import { eq, and, sql, desc, lt, SQL, inArray } from "drizzle-orm";
import { db } from "../../db";
import { posts, likes, users, follows } from "../../db/schema";
import { CodeSnippetSchema } from "../../db/schema/posts";
import { PostStatus } from "./interfaces/post.interface";
import { CreatePostInput } from "./dtos/create-post.dto";
import slugify from "slugify";
import sanitizeHtml from "sanitize-html";
import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import env from "@config/env";
import { interactionsService } from "../interactions/interactions.service";
import { addInteractionJob } from "@shared/queues/interaction.queue";
import { NotificationType } from "@modules/notification/interface/notification.interface";
import { addMediaCleanupJob } from "@shared/queues/media.queue";

interface CoverImageData {
  url: string;
  altText?: string;
  credit?: string;
}

class PostService {
  public async createPost(
    authorId: string,
    data: CreatePostInput & {
      media?: string[];
      codeSnippets?: CodeSnippetSchema[];
      coverImage?: CoverImageData; 
    },
  ): Promise<Awaited<ReturnType<typeof this.getPost>>> {
    const cleanContent = this.sanitizeContent(data.content);
    const slug = await this.generateUniqueSlug(data.title);
    const excerpt = data.subtitle || cleanContent.substring(0, 150) + "..." || "";
    const readTime = this.calculateReadTime(cleanContent);

    let newPostId: string;

    await db.transaction(async (tx) => {
      const mediaValue = data.media && data.media.length > 0 ? data.media : undefined;
      const tagsValue = data.tags && data.tags.length > 0 ? data.tags : undefined;
      const codeSnippetsValue = data.codeSnippets && data.codeSnippets.length > 0 ? data.codeSnippets : undefined;

      const [created] = await tx
        .insert(posts)
        .values({
          title: data.title,
          slug,
          subtitle: data.subtitle,
          content: cleanContent,
          excerpt,
          authorId,
          readTime,
          tags: tagsValue,
          media: mediaValue,
          codeSnippets: codeSnippetsValue,
          coverImageUrl: data.coverImage?.url,
          coverImageAltText: data.coverImage?.altText,
          coverImageCredit: data.coverImage?.credit, 
          status: data.isPublished ? PostStatus.PUBLISHED : PostStatus.DRAFT,
          publishDate: data.isPublished ? new Date() : undefined,
        })
        .returning({ id: posts.id });

      newPostId = created.id;

      await tx
        .update(users)
        .set({ totalPosts: sql`${users.totalPosts} + 1` })
        .where(eq(users.id, authorId));
    });

    return await this.getPost(newPostId!, authorId);
  }

  public async getPost(postId: string, requesterId?: string) {
    const selectFields = {
      post: posts,
      authorUsername: users.username,
      authorProfileImage: users.profileImageUrl,
      authorFullname: users.fullname,
      ...(requesterId
        ? {
            isLikedByMe: sql<boolean>`exists(select 1 from ${likes} where ${likes.postId} = ${posts.id} and ${likes.userId} = ${requesterId})`.mapWith(Boolean),
          }
        : {}),
    };

    const [row] = await db
      .select(selectFields)
      .from(posts)
      .leftJoin(users, eq(posts.authorId, users.id))
      .where(eq(posts.id, postId))
      .limit(1);

    if (!row) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    const isOwner = requesterId === row.post.authorId;
    if (!isOwner && row.post.status !== "published") {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    return {
      ...row.post,
      isLikedByMe: "isLikedByMe" in row ? !!row.isLikedByMe : false,
      author: {
        id: row.post.authorId,
        username: row.authorUsername,
        fullname: row.authorFullname,
        profileImageUrl: row.authorProfileImage,
      },
    };
  }

  public async getPosts(limit: number, cursor?: string, requesterId?: string, authorIdFilter?: string) {
    const selectFields = {
      id: posts.id,
      title: posts.title,
      slug: posts.slug,
      subtitle: posts.subtitle,
      content: posts.content,
      excerpt: posts.excerpt,
      media: posts.media,
      codeSnippets: posts.codeSnippets,
      coverImageUrl: posts.coverImageUrl,
      coverImageAltText: posts.coverImageAltText,
      tags: posts.tags,
      authorId: posts.authorId,
      status: posts.status,
      publishDate: posts.publishDate,
      viewCount: posts.viewCount,
      likeCount: posts.likeCount,
      commentCount: posts.commentCount,
      shareCount: posts.shareCount,
      readTime: posts.readTime,
      createdAt: posts.createdAt,
      authorUsername: users.username,
      authorProfileImage: users.profileImageUrl,
      authorFullname: users.fullname,
      ...(requesterId
        ? {
            isLikedByMe: sql<boolean>`exists(select 1 from ${likes} where ${likes.postId} = ${posts.id} and ${likes.userId} = ${requesterId})`.mapWith(Boolean),
          }
        : {}),
    };

    const conditions: SQL<unknown>[] = [eq(posts.status, "published")];

    if (cursor) {
      conditions.push(lt(posts.publishDate, new Date(cursor)));
    }

    if (authorIdFilter) {
      conditions.push(eq(posts.authorId, authorIdFilter));
    }

    const postsResult = await db
      .select(selectFields)
      .from(posts)
      .leftJoin(users, eq(posts.authorId, users.id))
      .where(and(...conditions))
      .orderBy(desc(posts.publishDate))
      .limit(limit);

    let followedAuthorIds = new Set<string>();

    if (requesterId && postsResult.length > 0) {
      // 1. Get all unique author IDs from the fetched posts
      const authorIds = [...new Set(postsResult.map((row) => row.authorId))].filter(Boolean) as string[];

      if (authorIds.length > 0) {
        // 2. Query the 'follows' table to see which of these authors the user follows
        const userFollows = await db
          .select({ followingId: follows.followingId })
          .from(follows)
          .where(
            and(
              eq(follows.followerId, requesterId),
              inArray(follows.followingId, authorIds)
            )
          );

        // 3. Store the results in an O(1) lookup Set
        followedAuthorIds = new Set(userFollows.map((f) => f.followingId));
      }
    }
    // ==========================================

    let nextCursor: string | null = null;
    if (postsResult.length === limit) {
      const lastPost = postsResult[postsResult.length - 1];
      if (lastPost.publishDate) {
        nextCursor = lastPost.publishDate.toISOString();
      }
    }

    const formattedPosts = postsResult.map((row) => {
      const { authorUsername, authorProfileImage, authorFullname, ...post } = row;

      return {
        ...post,
        isLikedByMe: "isLikedByMe" in row ? !!row.isLikedByMe : false,
        author: {
          id: post.authorId,
          username: authorUsername,
          fullname: authorFullname,
          profileImageUrl: authorProfileImage,
          isFollowingByMe: followedAuthorIds.has(post.authorId),
        },
      };
    });

    return {
      posts: formattedPosts,
      nextCursor,
    };
  }

  public async updatePost(
    postId: string,
    userId: string,
    data: Partial<CreatePostInput> & {
      media?: string[];
      codeSnippets?: CodeSnippetSchema[];
      coverImage?: CoverImageData; 
    },
  ): Promise<Awaited<ReturnType<typeof this.getPost>>> {
    const [post] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);

    if (!post) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    if (post.authorId !== userId) {
      throw new AppError(HTTP_STATUS.FORBIDDEN, "You are not authorized to edit this post");
    }

    const updates: Record<string, unknown> = {};

    if (data.title && data.title !== post.title) {
      updates.title = data.title;
      updates.slug = await this.generateUniqueSlug(data.title);
    }

    if (data.content) {
      updates.content = this.sanitizeContent(data.content);
      updates.readTime = this.calculateReadTime(updates.content as string);
    }

    if (data.subtitle !== undefined) updates.subtitle = data.subtitle;
    if (data.tags !== undefined) updates.tags = data.tags;

    if (data.isPublished !== undefined) {
      updates.status = data.isPublished ? PostStatus.PUBLISHED : PostStatus.DRAFT;
      if (data.isPublished && !post.publishDate) {
        updates.publishDate = new Date();
      }
    }

    if (data.coverImage) {
      updates.coverImageUrl = data.coverImage.url;
      updates.coverImageAltText = data.coverImage.altText;
      updates.coverImageCredit = data.coverImage.credit;
    }

    if (data.media !== undefined) {
      updates.media = data.media;
    }

    if (data.codeSnippets !== undefined) {
      updates.codeSnippets = data.codeSnippets;
    }

    updates.updatedAt = new Date();

    await db.update(posts).set(updates).where(eq(posts.id, postId));

    return await this.getPost(postId, userId);
  }

  public async deletePost(postId: string, userId: string, isAdmin: boolean = false): Promise<void> {
    const [post] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);

    if (!post) throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    if (post.authorId !== userId && !isAdmin) throw new AppError(HTTP_STATUS.FORBIDDEN, "Not authorized");

    await db.transaction(async (tx) => {
      await tx.update(posts).set({ status: "trash" }).where(eq(posts.id, postId));
      await tx.update(users).set({ totalPosts: sql`GREATEST(${users.totalPosts} - 1, 0)` }).where(eq(users.id, post.authorId));
    });

    const filesToDelete: string[] = [];
    if (post.coverImageUrl) filesToDelete.push(post.coverImageUrl);
    if (post.media && post.media.length > 0) filesToDelete.push(...post.media);

    await addMediaCleanupJob(filesToDelete);
  }

  public async likePost(postId: string, userId: string): Promise<{ status: "liked" | "unliked" }> {
    let resultStatus: "liked" | "unliked";
    let postAuthorId: string | null = null;

    await db.transaction(async (tx) => {
      const [existingLike] = await tx
        .select()
        .from(likes)
        .where(and(eq(likes.postId, postId), eq(likes.userId, userId)))
        .limit(1);

      if (existingLike) {
        await tx.delete(likes).where(and(eq(likes.postId, postId), eq(likes.userId, userId)));
        await tx.update(posts).set({ likeCount: sql`${posts.likeCount} - 1` }).where(eq(posts.id, postId));
        resultStatus = "unliked";
      } else {
        await tx.insert(likes).values({ postId, userId });
        const [post] = await tx.update(posts).set({ likeCount: sql`${posts.likeCount} + 1` }).where(eq(posts.id, postId)).returning({ authorId: posts.authorId });
        resultStatus = "liked";

        if (post && post.authorId !== userId) {
          postAuthorId = post.authorId;
        }
      }
    });

    if (postAuthorId) {
      await addInteractionJob({
        type: NotificationType.LIKE,
        recipientId: postAuthorId,
        actorId: userId,
        relatedId: postId,
        message: "liked your post",
      });
    }

    return { status: resultStatus! };
  }

  public async sharePost(postId: string, userId: string, platform: string): Promise<{ url: string; platform: string }> {
    const [post] = await db
      .update(posts)
      .set({ shareCount: sql`${posts.shareCount} + 1` })
      .where(eq(posts.id, postId))
      .returning({ slug: posts.slug, title: posts.title });

    if (!post) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    const baseUrl = env.CLIENT_URL || "https://writespace.com";
    const postUrl = `${baseUrl}/blog/${post.slug}`;

    let shareUrl = "";
    switch (platform.toLowerCase()) {
      case "twitter":
        shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(post.title)}&url=${encodeURIComponent(postUrl)}`;
        break;
      case "facebook":
        shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(postUrl)}`;
        break;
      case "linkedin":
        shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(postUrl)}`;
        break;
      default:
        shareUrl = postUrl;
    }

    await interactionsService.logShare(userId, postId, platform);

    return { url: shareUrl, platform };
  }

  private sanitizeContent(content: string): string {
    return sanitizeHtml(content, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "iframe"]),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        iframe: ["src", "width", "height", "allowfullscreen"],
      },
    });
  }

  private async generateUniqueSlug(title: string, maxRetries = 10): Promise<string> {
    const baseSlug = slugify(title, { lower: true, strict: true });
    let slug = baseSlug;
    let counter = 1;

    while (counter <= maxRetries) {
      const [existing] = await db
        .select({ id: posts.id })
        .from(posts)
        .where(eq(posts.slug, slug))
        .limit(1);

      if (!existing) return slug;

      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    const fallbackHash = Math.random().toString(36).substring(2, 8);
    return `${baseSlug}-${fallbackHash}`;
  }

  private calculateReadTime(content: string): number {
    const wordCount = content.split(/\s+/).length;
    return Math.ceil(wordCount / 200);
  }
}

export const postService = new PostService();