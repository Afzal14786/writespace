import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import { PostStatus } from "../interfaces/post.interface";

/**
 * Defines the allowed lifecycle transitions for a Post.
 *
 * - Drafts can be scheduled or published.
 * - Scheduled Posts can be published or moved back to draft.
 * - Published Posts can be moved back to draft (unpublished).
 *
 * Permanent deletion is handled separately by the command service.
 */
const VALID_TRANSITIONS: Record<PostStatus, readonly PostStatus[]> = {
  [PostStatus.DRAFT]: [PostStatus.SCHEDULED, PostStatus.PUBLISHED],

  [PostStatus.SCHEDULED]: [PostStatus.PUBLISHED, PostStatus.DRAFT],

  [PostStatus.PUBLISHED]: [PostStatus.DRAFT],
};

export function canTransition(from: PostStatus, to: PostStatus): boolean {
  // Updating a Post without changing its status is valid.
  if (from === to) {
    return true;
  }

  return VALID_TRANSITIONS[from].includes(to);
}

export function assertValidTransition(from: PostStatus, to: PostStatus): void {
  if (canTransition(from, to)) {
    return;
  }

  throw new AppError(
    HTTP_STATUS.BAD_REQUEST,
    `Invalid post status transition: ${from} → ${to}`,
  );
}

/**
 * Only published Posts are publicly visible.
 */
export function isPublicStatus(status: PostStatus): boolean {
  return status === PostStatus.PUBLISHED;
}

/**
 * Converts a database status into the PostStatus enum.
 * An unknown value indicates invalid data in the database.
 */
export function toPostStatus(status: string): PostStatus {
  if (Object.values(PostStatus).includes(status as PostStatus)) {
    return status as PostStatus;
  }

  throw new AppError(
    HTTP_STATUS.INTERNAL_SERVER_ERROR,
    `Invalid post status stored in database: ${status}`,
  );
}
