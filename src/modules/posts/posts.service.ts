import { eq, and, sql, desc, count, ne } from "drizzle-orm";
import { db } from "../../db";
import { posts, likes, users } from "../../db/schema";
import { Post } from "../../db/schema";
import { PostStatus } from "./interfaces/post.interface";
import { CreatePostInput } from "./dtos/create-post.dto";
import slugify from "slugify";
import sanitizeHtml from "sanitize-html";
import { AppError } from "../../shared/utils/app.error";
import { HTTP_STATUS } from "../../shared/constants/http-codes";
import env from "../../config/env";
import { interactionsService } from "../interactions/interactions.service";
import { addInteractionJob } from "../../shared/queues/interaction.queue";
import { NotificationType } from "../../modules/notification/interface/notification.interface";

class PostService {
  public async createPost(
    authorId: string,
    data: CreatePostInput,
  ): Promise<Post> {
    const cleanContent = this.sanitizeContent(data.content);
    const slug = await this.generateUniqueSlug(data.title);
    const excerpt = data.subtitle || cleanContent.substring(0, 150) + "...";
    const readTime = this.calculateReadTime(cleanContent);

    let newPost: Post;

    await db.transaction(async (tx) => {
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
          tags: data.tags || [],
          coverImageUrl: data.coverImage?.url,
          coverImageAltText: data.coverImage?.altText,
          coverImageCredit: data.coverImage?.credit,
          status: data.isPublished ? PostStatus.PUBLISHED : PostStatus.DRAFT,
          publishDate: data.isPublished ? new Date() : undefined,
        })
        .returning();

      newPost = created;

      await tx
        .update(users)
        .set({ totalPosts: sql`${users.totalPosts} + 1` })
        .where(eq(users.id, authorId));
    });

    return newPost!;
  }

  public async getPost(postId: string, requesterId?: string) {
    const [post] = await db
      .select({
        post: posts,
        authorUsername: users.username,
        authorProfileImage: users.profileImageUrl,
      })
      .from(posts)
      .leftJoin(users, eq(posts.authorId, users.id))
      .where(eq(posts.id, postId))
      .limit(1);

    if (!post) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    const isOwner = requesterId === post.post.authorId;
    if (!isOwner && post.post.status !== "published") {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    return {
      ...post.post,
      author: {
        username: post.authorUsername,
        profileImageUrl: post.authorProfileImage,
      },
    };
  }

  public async getPosts(page: number, limit: number) {
    const offset = (page - 1) * limit;

    const [postsResult, [totalResult]] = await Promise.all([
      db
        .select({
          id: posts.id,
          title: posts.title,
          slug: posts.slug,
          subtitle: posts.subtitle,
          excerpt: posts.excerpt,
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
        })
        .from(posts)
        .leftJoin(users, eq(posts.authorId, users.id))
        .where(eq(posts.status, "published"))
        .orderBy(desc(posts.publishDate))
        .offset(offset)
        .limit(limit),
      db
        .select({ total: count() })
        .from(posts)
        .where(eq(posts.status, "published")),
    ]);

    const formattedPosts = postsResult.map(
      ({ authorUsername, authorProfileImage, ...post }) => ({
        ...post,
        author: {
          username: authorUsername,
          profileImageUrl: authorProfileImage,
        },
      }),
    );

    return {
      posts: formattedPosts,
      total: totalResult.total,
    };
  }

  public async updatePost(
    postId: string,
    userId: string,
    data: Partial<CreatePostInput>,
  ): Promise<Post> {
    const [post] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);

    if (!post) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    if (post.authorId !== userId) {
      throw new AppError(
        HTTP_STATUS.FORBIDDEN,
        "You are not authorized to edit this post",
      );
    }

    const updates: Record<string, any> = {};

    if (data.title && data.title !== post.title) {
      updates.title = data.title;
      updates.slug = await this.generateUniqueSlug(data.title);
    }

    if (data.content) {
      updates.content = this.sanitizeContent(data.content);
      updates.readTime = this.calculateReadTime(updates.content);
    }

    if (data.subtitle !== undefined) updates.subtitle = data.subtitle;
    if (data.tags !== undefined) updates.tags = data.tags;

    if (data.isPublished !== undefined) {
      updates.status = data.isPublished
        ? PostStatus.PUBLISHED
        : PostStatus.DRAFT;
      if (data.isPublished && !post.publishDate) {
        updates.publishDate = new Date();
      }
    }

    if (data.coverImage) {
      updates.coverImageUrl = data.coverImage.url;
      updates.coverImageAltText = data.coverImage.altText;
      updates.coverImageCredit = data.coverImage.credit;
    }

    const [updatedPost] = await db
      .update(posts)
      .set(updates)
      .where(eq(posts.id, postId))
      .returning();

    return updatedPost;
  }

  public async deletePost(
    postId: string,
    userId: string,
    isAdmin: boolean = false,
  ): Promise<void> {
    const [post] = await db
      .select({ id: posts.id, authorId: posts.authorId })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);

    if (!post) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    if (post.authorId !== userId && !isAdmin) {
      throw new AppError(
        HTTP_STATUS.FORBIDDEN,
        "You are not authorized to delete this post",
      );
    }

    await db.transaction(async (tx) => {
      await tx
        .update(posts)
        .set({ status: "trash" })
        .where(eq(posts.id, postId));

      await tx
        .update(users)
        .set({ totalPosts: sql`GREATEST(${users.totalPosts} - 1, 0)` })
        .where(eq(users.id, post.authorId));
    });
  }

  public async likePost(
    postId: string,
    userId: string,
  ): Promise<{ status: "liked" | "unliked" }> {
    let resultStatus: "liked" | "unliked";
    let postAuthorId: string | null = null;

    await db.transaction(async (tx) => {
      const [existingLike] = await tx
        .select()
        .from(likes)
        .where(and(eq(likes.postId, postId), eq(likes.userId, userId)))
        .limit(1);

      if (existingLike) {
        await tx
          .delete(likes)
          .where(and(eq(likes.postId, postId), eq(likes.userId, userId)));
        await tx
          .update(posts)
          .set({ likeCount: sql`${posts.likeCount} - 1` })
          .where(eq(posts.id, postId));
        resultStatus = "unliked";
      } else {
        await tx.insert(likes).values({ postId, userId });
        const [post] = await tx
          .update(posts)
          .set({ likeCount: sql`${posts.likeCount} + 1` })
          .where(eq(posts.id, postId))
          .returning({ authorId: posts.authorId });
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

  public async sharePost(
    postId: string,
    userId: string,
    platform: string,
  ): Promise<{ url: string; platform: string }> {
    const [post] = await db
      .update(posts)
      .set({ shareCount: sql`${posts.shareCount} + 1` })
      .where(eq(posts.id, postId))
      .returning({ slug: posts.slug, title: posts.title });

    if (!post) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    const baseUrl = env.CLIENT_URL || "https://blogify.com";
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

  private async generateUniqueSlug(
    title: string,
    maxRetries = 5,
  ): Promise<string> {
    const base = slugify(title, { lower: true, strict: true });
    let slug = base;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const [existing] = await db
        .select({ id: posts.id })
        .from(posts)
        .where(eq(posts.slug, slug))
        .limit(1);

      if (!existing) return slug;

      slug = `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    }

    return slug;
  }

  private calculateReadTime(content: string): number {
    const wordCount = content.split(/\s+/).length;
    return Math.ceil(wordCount / 200);
  }
}

export const postService = new PostService();
