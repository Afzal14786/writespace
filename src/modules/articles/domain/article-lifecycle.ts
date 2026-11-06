import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";

import { ArticleStatus } from "../interfaces/article.interface";

/**
 * Defines the allowed lifecycle transitions for an Article.
 *
 * Draft:
 * - Can remain a draft.
 * - Can be scheduled for future publication.
 * - Can be published immediately.
 *
 * Scheduled:
 * - Can remain scheduled.
 * - Can return to draft.
 * - Can be published immediately.
 *
 * Published:
 * - Can remain published.
 * - Can be unpublished by returning to draft.
 *
 * Permanent deletion is handled separately by the command service.
 */
const VALID_TRANSITIONS: Record<ArticleStatus, readonly ArticleStatus[]> = {
  [ArticleStatus.DRAFT]: [ArticleStatus.SCHEDULED, ArticleStatus.PUBLISHED],

  [ArticleStatus.SCHEDULED]: [ArticleStatus.DRAFT, ArticleStatus.PUBLISHED],

  [ArticleStatus.PUBLISHED]: [ArticleStatus.DRAFT],
};

/**
 * Determine whether an Article can move from one lifecycle state
 * to another.
 *
 * Keeping the same status is valid because an update might modify
 * Article content without changing its publication state.
 */
export function canTransition(from: ArticleStatus, to: ArticleStatus): boolean {
  if (from === to) {
    return true;
  }

  return VALID_TRANSITIONS[from].includes(to);
}

/**
 * Enforce an Article lifecycle transition.
 *
 * Invalid transitions produce a 400 response rather than allowing
 * the command service to write an unsupported state.
 */
export function assertValidTransition(
  from: ArticleStatus,
  to: ArticleStatus,
): void {
  if (canTransition(from, to)) {
    return;
  }

  throw new AppError(
    HTTP_STATUS.BAD_REQUEST,
    `Invalid Article status transition: ${from} → ${to}`,
  );
}

/**
 * Check whether an Article is publicly visible.
 *
 * Only published Articles should be accessible through public
 * Article endpoints and social preview endpoints.
 */
export function isPublicStatus(status: ArticleStatus): boolean {
  return status === ArticleStatus.PUBLISHED;
}

/**
 * Convert a database status into the ArticleStatus type.
 *
 * An unexpected value indicates inconsistent data in the database
 * and should be treated as an internal server error.
 */
export function toArticleStatus(status: string): ArticleStatus {
  if (Object.values(ArticleStatus).includes(status as ArticleStatus)) {
    return status as ArticleStatus;
  }

  throw new AppError(
    HTTP_STATUS.INTERNAL_SERVER_ERROR,
    `Invalid Article status stored in database: ${status}`,
  );
}
