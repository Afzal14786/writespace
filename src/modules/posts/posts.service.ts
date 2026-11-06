import { and, eq } from "drizzle-orm";

import { db } from "../../db";
import { contentItems, posts } from "../../db/schema";

import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import env from "@config/env";

import { interactionsService } from "../interactions/interactions.service";

import { extractContentText } from "./domain/post-content";

import { postQueryService } from "./services/post-query.service";

import {
  postCommandService,
  type CreatePostData,
  type UpdatePostData,
} from "./services/post-command.service";

class PostService {
  /**
   * Create a Post and return its complete representation.
   *
   * The command service handles all database writes. Once creation
   * succeeds, the query service retrieves the Post in the same format
   * used by the Post detail endpoint.
   */
  public async createPost(authorId: string, data: CreatePostData) {
    const postId = await postCommandService.createPost(authorId, data);

    return this.getPost(postId, authorId);
  }

  /**
   * Retrieve one Post.
   *
   * Visibility and ownership rules are enforced by the query service.
   */
  public async getPost(postId: string, requesterId?: string) {
    return postQueryService.getPost(postId, requesterId);
  }

  /**
   * Retrieve a paginated feed of published Posts.
   *
   * The optional author filter allows the same query service to support
   * author-specific Post listings.
   */
  public async getPosts(
    limit: number,
    cursor?: string,
    requesterId?: string,
    authorIdFilter?: string,
  ) {
    return postQueryService.getPosts(
      limit,
      cursor,
      requesterId,
      authorIdFilter,
    );
  }

  /**
   * Update an existing Post and return its latest representation.
   *
   * The command service handles ownership validation, lifecycle
   * transitions, document updates, mentions, and media synchronization.
   */
  public async updatePost(
    postId: string,
    userId: string,
    data: UpdatePostData,
  ) {
    await postCommandService.updatePost(postId, userId, data);

    return this.getPost(postId, userId);
  }

  /**
   * Permanently delete a Post.
   *
   * This operation is irreversible. The command service verifies
   * ownership, deletes the content item and its dependent database
   * records, and queues associated Cloudinary assets for cleanup.
   */
  public async deletePost(postId: string, userId: string): Promise<void> {
    await postCommandService.deletePost(postId, userId);
  }

  /**
   * Toggle Like on a published Post.
   *
   * The interaction service performs the operation atomically
   * and updates the shared content reaction counter.
   */
  public async likePost(
    postId: string,
    userId: string,
  ): Promise<{
    status: "liked" | "unliked";
  }> {
    const reaction = await interactionsService.toggleContentItemLike(
      userId,
      postId,
    );

    return {
      status: reaction.isReacted ? "liked" : "unliked",
    };
  }
  /**
   * Generate a platform-specific sharing URL and record the interaction.
   *
   * Short Posts no longer have slugs or titles. Their canonical URL
   * therefore uses the stable Post ID.
   *
   * Only published Posts can be shared because drafts and scheduled
   * Posts are not publicly accessible.
   */
  public async sharePost(
    postId: string,
    userId: string,
    platform: string,
  ): Promise<{
    url: string;
    platform: string;
  }> {
    const [post] = await db
      .select({
        status: contentItems.status,
        contentDocument: posts.contentDocument,
      })
      .from(contentItems)
      .innerJoin(posts, eq(posts.id, contentItems.id))
      .where(
        and(eq(contentItems.id, postId), eq(contentItems.contentType, "post")),
      )
      .limit(1);

    if (!post) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    if (post.status !== "published") {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }

    const baseUrl = env.CLIENT_URL || "https://writespace.com";

    /*
     * Use the Post ID instead of a slug.
     *
     * This assumes the frontend's canonical Post detail route is:
     * /posts/:postId
     */
    const postUrl = new URL(
      `/posts/${postId}`,
      `${baseUrl.replace(/\/+$/, "")}/`,
    ).toString();

    const normalizedPlatform = platform.trim().toLowerCase();

    /*
     * The structured document has no title field.
     * Extract readable text for platforms that support a share caption.
     */
    const shareText = extractContentText(post.contentDocument)
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 250);

    let shareUrl: string;

    switch (normalizedPlatform) {
      case "twitter":
      case "x": {
        const url = new URL("https://twitter.com/intent/tweet");

        if (shareText) {
          url.searchParams.set("text", shareText);
        }

        url.searchParams.set("url", postUrl);

        shareUrl = url.toString();
        break;
      }

      case "facebook": {
        const url = new URL("https://www.facebook.com/sharer/sharer.php");

        url.searchParams.set("u", postUrl);

        shareUrl = url.toString();
        break;
      }

      case "linkedin": {
        const url = new URL("https://www.linkedin.com/sharing/share-offsite/");

        url.searchParams.set("url", postUrl);

        shareUrl = url.toString();
        break;
      }

      default:
        // Unknown or direct-sharing platforms receive the canonical URL.
        shareUrl = postUrl;
    }

    // Record the share after the destination URL has been generated.
    await interactionsService.createShare({
      actorId: userId,
      postId,
      platform: normalizedPlatform,
    });

    return {
      url: shareUrl,
      platform: normalizedPlatform,
    };
  }
}

export const postService = new PostService();
