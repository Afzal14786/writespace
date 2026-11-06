import { randomUUID } from "node:crypto";
import slugify from "slugify";

/**
 * Generate a URL-friendly base slug from an Article title.
 *
 * Examples:
 * - "Understanding Redis Internals" -> "understanding-redis-internals"
 * - "Building Scalable Systems!" -> "building-scalable-systems"
 *
 * The base slug is not guaranteed to be unique.
 * Uniqueness is handled separately when creating the Article.
 */
export function generateArticleBaseSlug(title: string): string {
  const normalizedTitle = title.trim();

  if (!normalizedTitle) {
    return "";
  }

  return slugify(normalizedTitle, {
    lower: true,
    strict: true,
    trim: true,
  });
}

/**
 * Generate a unique Article slug candidate.
 *
 * A UUID suffix makes collisions extremely unlikely, including when
 * multiple users publish Articles with identical titles.
 *
 * The Articles command service must still rely on the database's
 * unique constraint as the final guarantee of uniqueness.
 */
export function generateArticleSlugCandidate(title: string): string {
  const baseSlug = generateArticleBaseSlug(title);

  // DTO validation should normally prevent empty titles.
  // The fallback also handles titles containing only unsupported characters.
  const slugPrefix = baseSlug || "article";

  return `${slugPrefix}-${randomUUID()}`;
}
