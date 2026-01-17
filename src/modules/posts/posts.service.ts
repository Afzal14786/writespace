import { PostModel } from "./posts.model";
import { LikeModel } from "../interactions/like.model";
import { IPost, PostStatus } from "./interfaces/post.interface";
import { CreatePostInput } from "./dtos/create-post.dto";
import slugify from "slugify";
import sanitizeHtml from "sanitize-html";
import { AppError } from "../../shared/utils/app.error";
import { HTTP_STATUS } from "../../shared/constants/http-codes";
import env from "../../config/env";
import { addInteractionJob } from "../../shared/queues/interaction.queue";
import { NotificationType } from "../../modules/notification/interface/notification.interface";

/**
 * @class PostService
 * @description Handles complex business logic for Blog Posts.
 */
class PostService {
  /**
   * Create a new post with sanitization and slug generation
   */
  public async createPost(
    authorId: string,
    data: CreatePostInput,
  ): Promise<IPost> {
    // 1. Sanitization: Strip malicious scripts
    const cleanContent = this.sanitizeContent(data.content);

    // 2. Slug Generation: Ensure uniqueness
    const slug = await this.generateUniqueSlug(data.title);

    // 3. Excerpt Extraction
    const excerpt = data.subtitle || cleanContent.substring(0, 150) + "...";

    // 4. Read Time Calculation
    const readTime = this.calculateReadTime(cleanContent);

    const newPost = new PostModel({
      ...data,
      content: cleanContent,
      slug,
      excerpt,
      author: authorId,
      readTime,
      status: data.isPublished ? PostStatus.PUBLISHED : PostStatus.DRAFT,
      publishDate: data.isPublished ? new Date() : undefined,
    });

    return newPost.save();
  }

  /**
   * Updates an existing post with ownership check.
   */
  public async updatePost(
    postId: string,
    userId: string,
    data: Partial<CreatePostInput>,
  ): Promise<IPost> {
    const post = await PostModel.findById(postId);

    if (!post) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    if (post.author.toString() !== userId) {
      throw new AppError(
        HTTP_STATUS.FORBIDDEN,
        "You are not authorized to edit this post",
      );
    }

    // If title changes, re-generate slug
    if (data.title && data.title !== post.title) {
      post.slug = await this.generateUniqueSlug(data.title);
    }

    if (data.content) {
      post.content = this.sanitizeContent(data.content);
      post.readTime = this.calculateReadTime(post.content);
    }

    Object.assign(post, data);

    // Handle explicit status change logic if needed
    if (data.isPublished !== undefined) {
      post.status = data.isPublished ? PostStatus.PUBLISHED : PostStatus.DRAFT;
      if (data.isPublished && !post.publishDate) {
        post.publishDate = new Date();
      }
    }

    return post.save();
  }

  /**
   * Soft deletes a post (moves to TRASH) if user owns it.
   */
  public async deletePost(
    postId: string,
    userId: string,
    isAdmin: boolean = false,
  ): Promise<void> {
    const post = await PostModel.findById(postId);

    if (!post) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    if (post.author.toString() !== userId && !isAdmin) {
      throw new AppError(
        HTTP_STATUS.FORBIDDEN,
        "You are not authorized to delete this post",
      );
    }

    post.status = PostStatus.TRASH;
    await post.save();
  }

  /**
   * Toggles like status for a post.
   */
  public async likePost(
    postId: string,
    userId: string,
  ): Promise<{ status: "liked" | "unliked" }> {
    const existingLike = await LikeModel.findOne({
      post: postId,
      user: userId,
    });

    if (existingLike) {
      // Unlike
      await existingLike.deleteOne();
      await PostModel.findByIdAndUpdate(postId, {
        $inc: { "stats.likeCount": -1 },
      });
      return { status: "unliked" };
    } else {
      // Like
      await LikeModel.create({ post: postId, user: userId });
      const post = await PostModel.findByIdAndUpdate(postId, {
        $inc: { "stats.likeCount": 1 },
      });

      if (post && post.author.toString() !== userId) {
        await addInteractionJob({
          type: NotificationType.LIKE,
          recipientId: post.author.toString(),
          actorId: userId,
          relatedId: postId,
          message: "liked your post",
        });
      }

      return { status: "liked" };
    }
  }

  /**
   * Generates a shareable link and increments share count.
   */
  public async sharePost(
    postId: string,
    platform: string,
  ): Promise<{ url: string; platform: string }> {
    const post = await PostModel.findByIdAndUpdate(
      postId,
      { $inc: { "stats.shareCount": 1 } },
      { new: true },
    );

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

    return { url: shareUrl, platform };
  }

  // --- Private Helpers ---

  private sanitizeContent(content: string): string {
    return sanitizeHtml(content, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "iframe"]),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        iframe: ["src", "width", "height", "allowfullscreen"],
      },
    });
  }

  private async generateUniqueSlug(title: string): Promise<string> {
    let slug = slugify(title, { lower: true, strict: true });
    const existingSlug = await PostModel.findOne({ slug });
    if (existingSlug) {
      slug = `${slug}-${Date.now()}`;
    }
    return slug;
  }

  private calculateReadTime(content: string): number {
    const wordCount = content.split(/\s+/).length;
    return Math.ceil(wordCount / 200);
  }
}

export const postService = new PostService();
