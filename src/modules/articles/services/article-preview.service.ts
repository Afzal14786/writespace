import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "../../../db";

import { articles, contentItems, users } from "../../../db/schema";

import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";

import { generateArticleExcerpt } from "../domain/article-content";

/**
 * Public information required to generate Article social metadata.
 *
 * This is intentionally a limited representation.
 * Social platforms do not need internal database fields,
 * Cloudinary public IDs, or private interaction information.
 */
export interface PublicArticlePreview {
  id: string;
  slug: string;
  canonicalPath: string;

  title: string;
  description: string;
  subtitle: string | null;

  author: {
    name: string;
    username: string;
    profileImageUrl: string | null;
  };

  publishedAt: Date;

  tags: string[];

  image: {
    url: string;
    altText: string | null;
    credit: string | null;
  } | null;
}

/**
 * Metadata presentation limits.
 *
 * These are preview limits, not Article content limits.
 */
const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 220;

/**
 * Truncate text without splitting Unicode characters.
 *
 * This handles emoji and other supplementary Unicode characters
 * safely when generating compact metadata.
 */
function truncateText(value: string, maxLength: number): string {
  const characters = Array.from(value);

  if (characters.length <= maxLength) {
    return value;
  }

  return `${characters
    .slice(0, maxLength - 1)
    .join("")
    .trimEnd()}…`;
}

/**
 * Normalize and prepare Article description metadata.
 *
 * Prefer the stored Article excerpt when available.
 * Generate an excerpt from the structured document as a fallback.
 */
function createDescription(excerpt: string | null): string {
  const normalizedExcerpt = excerpt?.replace(/\s+/g, " ").trim();

  if (!normalizedExcerpt) {
    return "Read this Article on Writespace.";
  }

  return truncateText(normalizedExcerpt, MAX_DESCRIPTION_LENGTH);
}

class ArticlePreviewService {
  /**
   * Retrieve public metadata for a published Article.
   *
   * Visibility rules:
   * - Content type must be "article".
   * - Status must be "published".
   * - A publication timestamp must exist.
   *
   * Draft and scheduled Articles are treated as not found.
   *
   * Only public metadata is selected. Sensitive or internal
   * database fields are deliberately excluded.
   */
  public async getPublicArticlePreview(
    articleSlug: string,
  ): Promise<PublicArticlePreview> {
    if (!articleSlug.trim() || articleSlug.length > 250) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid Article slug");
    }

    const [article] = await db
      .select({
        id: contentItems.id,
        publishDate: contentItems.publishDate,

        title: articles.title,
        slug: articles.slug,
        subtitle: articles.subtitle,
        excerpt: articles.excerpt,
        contentDocument: articles.contentDocument,
        tags: articles.tags,

        coverImageUrl: articles.coverImageUrl,
        coverImageAltText: articles.coverImageAltText,
        coverImageCredit: articles.coverImageCredit,

        username: users.username,
        fullname: users.fullname,
        profileImageUrl: users.profileImageUrl,
      })
      .from(contentItems)
      .innerJoin(articles, eq(articles.id, contentItems.id))
      .innerJoin(users, eq(users.id, contentItems.authorId))
      .where(
        and(
          eq(articles.slug, articleSlug),
          eq(contentItems.contentType, "article"),
          eq(contentItems.status, "published"),
          isNotNull(contentItems.publishDate),
        ),
      )
      .limit(1);

    if (!article || !article.publishDate) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Article not found");
    }

    /*
     * Use the actual Article title for social metadata.
     *
     * Unlike short Posts, Articles have a dedicated title field.
     */
    const title = truncateText(
      `${article.title} | Writespace`,
      MAX_TITLE_LENGTH,
    );

    /*
     * Prefer the stored excerpt.
     *
     * If the excerpt is empty, generate one from the Article's
     * structured content document.
     */
    const sourceExcerpt =
      article.excerpt?.trim() ||
      generateArticleExcerpt(article.contentDocument, MAX_DESCRIPTION_LENGTH);

    const description = createDescription(sourceExcerpt);

    /*
     * The Article cover image is stored directly on the articles table.
     *
     * The Cloudinary publicId is intentionally excluded from the
     * response. The frontend only needs the public image URL.
     */
    const image = article.coverImageUrl
      ? {
          url: article.coverImageUrl,
          altText: article.coverImageAltText,
          credit: article.coverImageCredit,
        }
      : null;

    return {
      id: article.id,
      slug: article.slug,

      // Public Article pages use their readable slug.
      canonicalPath: `/articles/${article.slug}`,

      title,
      description,
      subtitle: article.subtitle,

      author: {
        name: article.fullname?.trim() || article.username,
        username: article.username,
        profileImageUrl: article.profileImageUrl,
      },

      publishedAt: article.publishDate,

      tags: article.tags ?? [],

      image,
    };
  }
}

export const articlePreviewService = new ArticlePreviewService();
