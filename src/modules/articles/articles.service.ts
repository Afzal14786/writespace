import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";

import env from "@config/env";

import { interactionsService } from "../interactions/interactions.service";

import {
  articleCommandService,
  type CreateArticleData,
  type UpdateArticleData,
} from "./services/article-command.service";

import { articleQueryService } from "./services/article-query.service";

import { articlePreviewService } from "./services/article-preview.service";

/**
 * Platforms supported by the Writespace sharing service.
 *
 * `generic` represents copying or directly opening the canonical
 * Article URL without using a platform-specific composer.
 */
const SHARE_PLATFORMS = [
  "linkedin",
  "x",
  "twitter",
  "whatsapp",
  "facebook",
  "reddit",
  "telegram",
  "bluesky",
  "pinterest",
  "email",
  "generic",
] as const;

type SharePlatform = (typeof SHARE_PLATFORMS)[number];

/**
 * Normalize the requested platform.
 *
 * Twitter is treated as an alias for X so analytics do not
 * unnecessarily split activity between two names for the same platform.
 */
function normalizePlatform(platform: string): SharePlatform {
  const normalized = platform.trim().toLowerCase();

  if (!SHARE_PLATFORMS.includes(normalized as SharePlatform)) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      `Unsupported sharing platform: ${platform}`,
    );
  }

  return normalized === "twitter" ? "x" : (normalized as SharePlatform);
}

/**
 * Prepare a short text value for sharing interfaces.
 *
 * Some platforms impose their own text-length restrictions.
 * The URL is passed separately where the platform supports it.
 */
function truncateShareText(value: string, maxLength = 240): string {
  const characters = Array.from(value);

  if (characters.length <= maxLength) {
    return value;
  }

  return `${characters
    .slice(0, maxLength - 1)
    .join("")
    .trimEnd()}…`;
}

class ArticleService {
  /**
   * Retrieve an Article and return its complete representation
   * immediately after successful creation.
   */
  public async createArticle(authorId: string, data: CreateArticleData) {
    const articleId = await articleCommandService.createArticle(authorId, data);

    return articleQueryService.getArticleById(articleId, authorId);
  }

  /**
   * Retrieve an Article by its public slug.
   *
   * This is the primary lookup used by public Article pages.
   */
  public async getArticleBySlug(slug: string, requesterId?: string) {
    return articleQueryService.getArticleBySlug(slug, requesterId);
  }

  /**
   * Retrieve an Article by its database UUID.
   *
   * Useful for internal operations and returning Article data
   * immediately after creation or modification.
   */
  public async getArticleById(articleId: string, requesterId?: string) {
    return articleQueryService.getArticleById(articleId, requesterId);
  }

  /**
   * Retrieve the paginated public Article feed.
   */
  public async getArticles(
    limit: number,
    cursor?: string,
    requesterId?: string,
    authorIdFilter?: string,
  ) {
    return articleQueryService.getArticles(
      limit,
      cursor,
      requesterId,
      authorIdFilter,
    );
  }

  /**
   * Update an Article and return its latest representation.
   *
   * The command service handles ownership validation, lifecycle
   * transitions, document updates, mentions, slug changes,
   * and cover-image synchronization.
   */
  public async updateArticle(
    articleId: string,
    userId: string,
    data: UpdateArticleData,
  ) {
    await articleCommandService.updateArticle(articleId, userId, data);

    return this.getArticleById(articleId, userId);
  }

  /**
   * Permanently delete an Article.
   *
   * Database deletion and Cloudinary cleanup are handled
   * by the command service.
   */
  public async deleteArticle(articleId: string, userId: string): Promise<void> {
    await articleCommandService.deleteArticle(articleId, userId);
  }

  /**
   * Retrieve public social-preview information for an Article.
   *
   * Draft and scheduled Articles are never exposed through
   * the public preview service.
   */
  public async getPublicArticlePreview(slug: string) {
    return articlePreviewService.getPublicArticlePreview(slug);
  }

  /**
   * Ensure an Article is published before allowing public engagement.
   *
   * The query service handles Article visibility, including private
   * Articles. This additional check prevents an owner from liking
   * or sharing their own unpublished Article.
   */
  private async getPublishedArticle(articleId: string, userId: string) {
    const article = await this.getArticleById(articleId, userId);

    if (article.status !== "published") {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Article not found");
    }

    return article;
  }

  /**
   * Toggle Like on a published Article.
   *
   * Uses the same atomic interaction operation as Posts.
   */
  public async likeArticle(
    articleId: string,
    userId: string,
  ): Promise<{
    status: "liked" | "unliked";
  }> {
    const reaction = await interactionsService.toggleContentItemLike(
      userId,
      articleId,
    );

    return {
      status: reaction.isReacted ? "liked" : "unliked",
    };
  }

  /**
   * Generate a platform-specific sharing URL and record
   * the corresponding share interaction.
   *
   * This creates a pre-filled sharing destination.
   * It does not publish a post directly on the external platform.
   */
  public async shareArticle(
    articleId: string,
    userId: string,
    platform: string,
  ): Promise<{
    url: string;
    platform: string;
  }> {
    const article = await this.getPublishedArticle(articleId, userId);

    const normalizedPlatform = normalizePlatform(platform);

    const clientUrl = env.CLIENT_URL || "https://writespace.com";

    /*
     * Articles use their stable public slug.
     *
     * The frontend route is expected to be:
     * /articles/:slug
     */
    const canonicalUrl = new URL(
      `/articles/${encodeURIComponent(article.slug)}`,
      `${clientUrl.replace(/\/+$/, "")}/`,
    ).toString();

    const shareTitle = truncateShareText(article.title, 240);

    let shareUrl: string;

    switch (normalizedPlatform) {
      case "linkedin": {
        const url = new URL("https://www.linkedin.com/sharing/share-offsite/");

        url.searchParams.set("url", canonicalUrl);

        shareUrl = url.toString();
        break;
      }

      case "x": {
        const url = new URL("https://twitter.com/intent/tweet");

        url.searchParams.set("text", shareTitle);
        url.searchParams.set("url", canonicalUrl);

        shareUrl = url.toString();
        break;
      }

      case "whatsapp": {
        const message = `${shareTitle}\n${canonicalUrl}`;

        const url = new URL("https://wa.me/");

        url.searchParams.set("text", message);

        shareUrl = url.toString();
        break;
      }

      case "facebook": {
        const url = new URL("https://www.facebook.com/sharer/sharer.php");

        url.searchParams.set("u", canonicalUrl);

        shareUrl = url.toString();
        break;
      }

      case "reddit": {
        const url = new URL("https://www.reddit.com/submit");

        url.searchParams.set("url", canonicalUrl);
        url.searchParams.set("title", shareTitle);

        shareUrl = url.toString();
        break;
      }

      case "telegram": {
        const url = new URL("https://t.me/share/url");

        url.searchParams.set("url", canonicalUrl);
        url.searchParams.set("text", shareTitle);

        shareUrl = url.toString();
        break;
      }

      case "bluesky": {
        const url = new URL("https://bsky.app/intent/compose");

        url.searchParams.set("text", `${shareTitle}\n${canonicalUrl}`);

        shareUrl = url.toString();
        break;
      }

      case "pinterest": {
        const url = new URL("https://www.pinterest.com/pin/create/button/");

        url.searchParams.set("url", canonicalUrl);
        url.searchParams.set("description", shareTitle);

        if (article.coverImage?.url) {
          url.searchParams.set("media", article.coverImage.url);
        }

        shareUrl = url.toString();
        break;
      }

      case "email": {
        const url = new URL("mailto:");

        url.searchParams.set("subject", shareTitle);
        url.searchParams.set("body", canonicalUrl);

        shareUrl = url.toString();
        break;
      }

      case "generic":
      default:
        shareUrl = canonicalUrl;
        break;
    }

    /*
     * Record the share against the shared content identity.
     * This supports both Articles and Posts without using the
     * legacy Post-specific share contract.
     */
    await interactionsService.createContentItemShare({
      actorId: userId,
      contentItemId: articleId,
      platform: normalizedPlatform,
    });

    return {
      url: shareUrl,
      platform: normalizedPlatform,
    };
  }
}

export const articleService = new ArticleService();
