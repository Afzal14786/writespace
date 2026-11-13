import { Buffer } from "node:buffer";

import env from "@config/env";
import { db } from "../../../db";
import { eventPublisherService } from "@modules/notification/services/event-publisher.service";
import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import logger from "@config/logger";

import type {
  SavedPostCursor,
  SavedPostQuery,
  SavedPostResult,
  SavePostInput,
  UnsavePostInput,
} from "../contracts/save.types";

import { interactionEventMapper } from "../events/interaction-event.mapper";
import { interactionEventPublisher } from "../events/interaction-event.publisher";

import {
  saveRepository,
  type SavedContentCursor,
} from "../repositories/save.repository";

/**
 * Input for saving a generic content item.
 *
 * A content item can represent either a Post or an Article.
 */
export interface SaveContentItemInput {
  actorId: string;
  contentItemId: string;
}

/**
 * Input for removing a saved content item.
 */
export interface UnsaveContentItemInput {
  actorId: string;
  contentItemId: string;
}

/**
 * Result of a generic save operation.
 */
export interface SavedContentResult {
  userId: string;
  contentItemId: string;
  isSaved: boolean;
}

/**
 * Query parameters for retrieving saved Posts and Articles.
 */
export interface SavedContentQuery {
  userId: string;
  limit: number;
  cursor?: string;
}

/**
 * UUID validation for opaque pagination cursors.
 */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate the timestamp format used by cursor pagination.
 *
 * Six fractional digits preserve PostgreSQL microsecond precision.
 */
const CURSOR_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export class SaveService {
  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  /**
   * Verify that a content item exists and belongs to a supported type.
   *
   * Supported types:
   * - post
   * - article
   */
  private async ensureContentItemExists(contentItemId: string): Promise<void> {
    const contentItem = await saveRepository.findContentItem(contentItemId);

    if (!contentItem) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Content not found");
    }
  }

  /**
   * Verify that a requested ID belongs to an actual Post.
   *
   * Retained for the legacy Post-specific API.
   */
  private async ensurePostExists(postId: string): Promise<void> {
    const post = await saveRepository.findPost(postId);

    if (!post) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }
  }

  /**
   * Validate pagination limits.
   *
   * Default limit is supplied by the calling API.
   * Maximum page size is 100.
   */
  private validateLimit(limit: number): void {
    if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Limit must be an integer between 1 and 100",
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Generic saved-content cursor
  // ---------------------------------------------------------------------------

  /**
   * Encode the last returned content item's position into an opaque cursor.
   */
  private encodeContentCursor(cursor: SavedContentCursor): string {
    return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
  }

  /**
   * Decode and validate a generic saved-content pagination cursor.
   *
   * The timestamp is kept as a string so PostgreSQL microsecond
   * precision is not lost through JavaScript Date conversion.
   */
  private parseContentCursor(cursor?: string): SavedContentCursor | undefined {
    if (!cursor) {
      return undefined;
    }

    try {
      if (cursor.length > 512) {
        throw new Error("Cursor is too long");
      }

      const decoded = Buffer.from(cursor, "base64url").toString("utf8");

      const parsed: unknown = JSON.parse(decoded);

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("createdAt" in parsed) ||
        !("contentItemId" in parsed)
      ) {
        throw new Error("Invalid cursor structure");
      }

      const { createdAt, contentItemId } = parsed;

      const validTimestamp =
        typeof createdAt === "string" &&
        CURSOR_DATE_REGEX.test(createdAt) &&
        !Number.isNaN(Date.parse(createdAt));

      const validContentItemId =
        typeof contentItemId === "string" && UUID_REGEX.test(contentItemId);

      if (!validTimestamp || !validContentItemId) {
        throw new Error("Invalid cursor values");
      }

      return {
        createdAt,
        contentItemId,
      };
    } catch {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Invalid saved-content cursor",
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Generic content-item saves
  // ---------------------------------------------------------------------------

  /**
   * Save a Post or Article.
   *
   * The content_saves table stores both types using contentItemId.
   *
   * Duplicate save requests are idempotent: they return the existing
   * saved state without publishing another interaction event.
   */
  public async saveContentItem(
    input: SaveContentItemInput,
  ): Promise<SavedContentResult> {
    const { actorId, contentItemId } = input;

    await this.ensureContentItemExists(contentItemId);

    /*
     * When the new pipeline is enabled, the save relationship and outbox
     * event must commit together.
     *
     * When disabled, preserve the existing repository behavior.
     */
    const saved = env.OUTBOX_PROCESSING_ENABLED
      ? await db.transaction(async (transaction) => {
          const created = await saveRepository.createContentItemSave(
            actorId,
            contentItemId,
            transaction,
          );

          // Duplicate save requests are idempotent.
          if (!created) {
            return null;
          }

          await eventPublisherService.recordInTransaction(transaction, {
            eventName: "save.created",
            eventVersion: 1,
            producer: "interactions",
            aggregate: {
              type: "content_item",
              id: contentItemId,
            },
            actorId,
            payload: {
              contentItemId,
            },
          });

          return created;
        })
      : await saveRepository.createContentItemSave(actorId, contentItemId);

    if (!saved) {
      return {
        userId: actorId,
        contentItemId,
        isSaved: true,
      };
    }

    /*
     * Keep interaction history separate from notification processing.
     * This historical record is best-effort and is written after the
     * save and its outbox event have committed.
     */
    try {
      const event = interactionEventMapper.mapSaveEvent("save.created", {
        actorId,
        contentItemId,
      });

      await interactionEventPublisher.publish(event);
    } catch (error: unknown) {
      logger.error("Failed to publish save.created interaction history", {
        actorId,
        contentItemId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      userId: saved.userId,
      contentItemId: saved.contentItemId,
      isSaved: true,
    };
  }

  /**
   * Remove a saved Post or Article.
   *
   * Removing a nonexistent save is idempotent and does not
   * generate an interaction event.
   */
  public async unsaveContentItem(
    input: UnsaveContentItemInput,
  ): Promise<SavedContentResult> {
    const { actorId, contentItemId } = input;

    const saved = env.OUTBOX_PROCESSING_ENABLED
      ? await db.transaction(async (transaction) => {
          const deleted = await saveRepository.deleteContentItemSave(
            actorId,
            contentItemId,
            transaction,
          );

          // Removing a nonexistent save is idempotent.
          if (!deleted) {
            return null;
          }

          await eventPublisherService.recordInTransaction(transaction, {
            eventName: "save.removed",
            eventVersion: 1,
            producer: "interactions",
            aggregate: {
              type: "content_item",
              id: contentItemId,
            },
            actorId,
            payload: {
              contentItemId,
            },
          });

          return deleted;
        })
      : await saveRepository.deleteContentItemSave(actorId, contentItemId);

    if (!saved) {
      return {
        userId: actorId,
        contentItemId,
        isSaved: false,
      };
    }

    try {
      const event = interactionEventMapper.mapSaveEvent("save.removed", {
        actorId,
        contentItemId,
      });

      await interactionEventPublisher.publish(event);
    } catch (error: unknown) {
      logger.error("Failed to publish save.removed interaction history", {
        actorId,
        contentItemId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      userId: saved.userId,
      contentItemId: saved.contentItemId,
      isSaved: false,
    };
  }

  /**
   * Check whether a user has saved a Post or Article.
   */
  public async isContentItemSaved(
    userId: string,
    contentItemId: string,
  ): Promise<boolean> {
    return saveRepository.isContentItemSaved(userId, contentItemId);
  }

  /**
   * Retrieve a user's saved Posts and Articles using cursor pagination.
   *
   * The extra fetched record determines whether another page exists.
   * It is not included in the response.
   *
   * The result contains saved-content references and content types.
   * It does not hydrate the full Article or Post representation.
   */
  public async getSavedContent(input: SavedContentQuery) {
    const { userId, limit, cursor } = input;

    this.validateLimit(limit);

    const parsedCursor = this.parseContentCursor(cursor);

    const fetchedContent = await saveRepository.getSavedContent(
      userId,
      limit + 1,
      parsedCursor,
    );

    const hasMore = fetchedContent.length > limit;

    const pageContent = fetchedContent.slice(0, limit);

    const lastSavedContent = pageContent[pageContent.length - 1];

    const nextCursor =
      hasMore && lastSavedContent
        ? this.encodeContentCursor({
            createdAt: lastSavedContent.cursorCreatedAt,
            contentItemId: lastSavedContent.contentItemId,
          })
        : null;

    return {
      savedContent: pageContent.map(
        ({ cursorCreatedAt: _cursorCreatedAt, ...savedItem }) => savedItem,
      ),
      nextCursor,
    };
  }

  // ---------------------------------------------------------------------------
  // Backward-compatible Post-specific operations
  // ---------------------------------------------------------------------------

  /**
   * Save a Post using the existing Post-specific contract.
   *
   * New application code should use saveContentItem().
   */
  public async savePost(input: SavePostInput): Promise<SavedPostResult> {
    const { actorId, postId } = input;

    await this.ensurePostExists(postId);

    const saved = await this.saveContentItem({
      actorId,
      contentItemId: postId,
    });

    return {
      userId: saved.userId,
      postId: saved.contentItemId,
      isSaved: saved.isSaved,
    };
  }

  public async unsavePost(input: UnsavePostInput): Promise<SavedPostResult> {
    const { actorId, postId } = input;

    const saved = await this.unsaveContentItem({
      actorId,
      contentItemId: postId,
    });

    return {
      userId: saved.userId,
      postId: saved.contentItemId,
      isSaved: saved.isSaved,
    };
  }

  /**
   * Check whether a user saved a Post.
   */
  public async isPostSaved(userId: string, postId: string): Promise<boolean> {
    return saveRepository.isPostSaved(userId, postId);
  }

  /**
   * Retrieve only saved Posts using the existing pagination contract.
   *
   * This method remains available for existing Post-specific API consumers.
   */
  public async getSavedPosts(input: SavedPostQuery) {
    const { userId, limit, cursor } = input;

    this.validateLimit(limit);

    const parsedCursor = this.parsePostCursor(cursor);

    const fetchedSavedPosts = await saveRepository.getSavedPosts(
      userId,
      limit + 1,
      parsedCursor,
    );

    const hasMore = fetchedSavedPosts.length > limit;

    const pageSavedPosts = fetchedSavedPosts.slice(0, limit);

    const lastSavedPost = pageSavedPosts[pageSavedPosts.length - 1];

    const nextCursor =
      hasMore && lastSavedPost
        ? this.encodePostCursor({
            createdAt: lastSavedPost.cursorCreatedAt,
            postId: lastSavedPost.postId,
          })
        : null;

    return {
      savedPosts: pageSavedPosts.map(
        ({ cursorCreatedAt: _cursorCreatedAt, ...savedPost }) => savedPost,
      ),
      nextCursor,
    };
  }

  // ---------------------------------------------------------------------------
  // Legacy Post cursor helpers
  // ---------------------------------------------------------------------------

  /**
   * Encode the legacy Post pagination cursor.
   */
  private encodePostCursor(cursor: SavedPostCursor): string {
    return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
  }

  /**
   * Decode the legacy Post pagination cursor.
   *
   * Kept separate from the generic cursor because the old API
   * uses postId rather than contentItemId.
   */
  private parsePostCursor(cursor?: string): SavedPostCursor | undefined {
    if (!cursor) {
      return undefined;
    }

    try {
      if (cursor.length > 512) {
        throw new Error("Cursor is too long");
      }

      const decoded = Buffer.from(cursor, "base64url").toString("utf8");

      const parsed: unknown = JSON.parse(decoded);

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("createdAt" in parsed) ||
        !("postId" in parsed)
      ) {
        throw new Error("Invalid cursor structure");
      }

      const { createdAt, postId } = parsed;

      const validTimestamp =
        typeof createdAt === "string" &&
        CURSOR_DATE_REGEX.test(createdAt) &&
        !Number.isNaN(Date.parse(createdAt));

      const validPostId = typeof postId === "string" && UUID_REGEX.test(postId);

      if (!validTimestamp || !validPostId) {
        throw new Error("Invalid cursor values");
      }

      return {
        createdAt,
        postId,
      };
    } catch {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid saved-Post cursor");
    }
  }
}

export const saveService = new SaveService();
