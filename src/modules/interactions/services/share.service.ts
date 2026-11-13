import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import logger from "@config/logger";
import env from "@config/env";
import { db } from "../../../db";
import { eventPublisherService } from "@modules/notification/services/event-publisher.service";

import type {
  ContentItemSharePageResult,
  ContentItemShareResult,
  CreateContentItemShareInput,
  CreateShareInput,
  ShareCursor,
  SharePageResult,
  ShareResult,
} from "../contracts/share.types";

import { interactionEventMapper } from "../events/interaction-event.mapper";
import { interactionEventPublisher } from "../events/interaction-event.publisher";

import { shareRepository } from "../repositories/share.repository";

export class ShareService {
  /**
   * Ensures the target exists and is a supported shared content type.
   * Both Posts and Articles are stored in content_items.
   */
  private async ensureContentItemExists(contentItemId: string): Promise<void> {
    const contentItem = await shareRepository.findContentItem(contentItemId);

    if (
      !contentItem ||
      (contentItem.contentType !== "post" &&
        contentItem.contentType !== "article")
    ) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Content not found");
    }
  }

  /**
   * Legacy Post-only validation for callers that explicitly require
   * the target to be a Post.
   */
  private async ensurePostExists(postId: string): Promise<void> {
    const post = await shareRepository.findPost(postId);

    if (!post) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
    }
  }

  private validateLimit(limit: number): void {
    if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Limit must be an integer between 1 and 100",
      );
    }
  }

  private validatePlatform(platform: string): string {
    if (typeof platform !== "string" || !platform.trim()) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Share platform is required");
    }

    return platform.trim();
  }

  /**
   * Encodes the last returned share's position into an opaque cursor.
   */
  private encodeCursor(cursor: ShareCursor): string {
    return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
  }

  /**
   * Decodes and validates a cursor received from the client.
   * The timestamp remains a string to preserve PostgreSQL microsecond
   * precision during the next-page query.
   */
  private parseCursor(cursor?: string): ShareCursor | undefined {
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
        !("id" in parsed)
      ) {
        throw new Error("Invalid cursor structure");
      }

      const { createdAt, id } = parsed;

      const validTimestamp =
        typeof createdAt === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(createdAt) &&
        !Number.isNaN(Date.parse(createdAt));

      const validId =
        typeof id === "number" && Number.isSafeInteger(id) && id > 0;

      if (!validTimestamp || !validId) {
        throw new Error("Invalid cursor values");
      }

      return { createdAt, id };
    } catch {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid cursor");
    }
  }

  /**
   * Creates a share for a Post or Article.
   *
   * The share record and content item's share counter are committed
   * together by the repository. Event publication is best-effort.
   */
  async createContentItemShare(
    input: CreateContentItemShareInput,
  ): Promise<ContentItemShareResult> {
    const { actorId, contentItemId } = input;
    const normalizedPlatform = this.validatePlatform(input.platform);

    await this.ensureContentItemExists(contentItemId);

    /*
     * The share record, share counter and outbox event must commit together
     * when the durable notification pipeline is enabled.
     */
    const share = env.OUTBOX_PROCESSING_ENABLED
      ? await db.transaction(async (transaction) => {
          const created = await shareRepository.createContentItemShare(
            actorId,
            contentItemId,
            normalizedPlatform,
            transaction,
          );

          if (!created) {
            return null;
          }

          await eventPublisherService.recordInTransaction(transaction, {
            eventName: "share.created",
            eventVersion: 1,
            producer: "interactions",
            aggregate: {
              type: "content_item",
              id: contentItemId,
            },
            actorId,
            payload: {
              contentItemId,
              platform: normalizedPlatform,
            },
          });

          return created;
        })
      : await shareRepository.createContentItemShare(
          actorId,
          contentItemId,
          normalizedPlatform,
        );

    if (!share) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Content not found",
      );
    }

    /*
     * Keep the old interaction history as a separate best-effort record.
     * It is deliberately published after the database transaction commits.
     */
    try {
      const event = interactionEventMapper.mapShareEvent({
        actorId,
        contentItemId,
        platform: normalizedPlatform,
      });

      await interactionEventPublisher.publish(event);
    } catch (error: unknown) {
      logger.error("Failed to publish share.created interaction history", {
        actorId,
        contentItemId,
        platform: normalizedPlatform,
        shareId: share.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      id: share.id,
      userId: share.userId,
      contentItemId: share.contentItemId,
      platform: share.platform,
      createdAt: share.createdAt,
    };
  }

  /**
   * Legacy Post-oriented create method.
   */
  async createShare(input: CreateShareInput): Promise<ShareResult> {
    await this.ensurePostExists(input.postId);

    const share = await this.createContentItemShare({
      actorId: input.actorId,
      contentItemId: input.postId,
      platform: input.platform,
    });

    return {
      id: share.id,
      userId: share.userId,
      postId: share.contentItemId,
      platform: share.platform,
      createdAt: share.createdAt,
    };
  }

  async getContentItemShareById(
    id: number,
  ): Promise<ContentItemShareResult | null> {
    if (!Number.isInteger(id) || id <= 0) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid share id");
    }

    const share = await shareRepository.getShareById(id);

    if (!share) {
      return null;
    }

    return {
      id: share.id,
      userId: share.userId,
      contentItemId: share.contentItemId,
      platform: share.platform,
      createdAt: share.createdAt,
    };
  }

  /**
   * Legacy Post-oriented lookup.
   */
  async getShareById(id: number): Promise<ShareResult | null> {
    const share = await this.getContentItemShareById(id);

    if (!share) {
      return null;
    }

    return {
      id: share.id,
      userId: share.userId,
      postId: share.contentItemId,
      platform: share.platform,
      createdAt: share.createdAt,
    };
  }

  /**
   * Retrieves shares for any content item using cursor pagination.
   * One additional record is fetched to determine whether another
   * page exists.
   */
  async getContentItemShares(
    contentItemId: string,
    limit: number,
    cursor?: string,
  ): Promise<ContentItemSharePageResult> {
    this.validateLimit(limit);

    const parsedCursor = this.parseCursor(cursor);

    const fetchedShares = await shareRepository.getContentItemShares(
      contentItemId,
      limit + 1,
      parsedCursor,
    );

    const hasMore = fetchedShares.length > limit;
    const pageShares = fetchedShares.slice(0, limit);
    const lastShare = pageShares[pageShares.length - 1];

    const nextCursor =
      hasMore && lastShare
        ? this.encodeCursor({
            createdAt: lastShare.cursorCreatedAt,
            id: lastShare.id,
          })
        : null;

    return {
      shares: pageShares.map((share) => ({
        id: share.id,
        userId: share.userId,
        contentItemId: share.contentItemId,
        platform: share.platform,
        createdAt: share.createdAt,
      })),
      nextCursor,
    };
  }

  /**
   * Legacy Post-oriented pagination.
   */
  async getPostShares(
    postId: string,
    limit: number,
    cursor?: string,
  ): Promise<SharePageResult> {
    const result = await this.getContentItemShares(postId, limit, cursor);

    return {
      shares: result.shares.map((share) => ({
        id: share.id,
        userId: share.userId,
        postId: share.contentItemId,
        platform: share.platform,
        createdAt: share.createdAt,
      })),
      nextCursor: result.nextCursor,
    };
  }

  async getUserContentItemShares(
    userId: string,
    contentItemId: string,
  ): Promise<ContentItemShareResult[]> {
    const shares = await shareRepository.getUserContentItemShares(
      userId,
      contentItemId,
    );

    return shares.map((share) => ({
      id: share.id,
      userId: share.userId,
      contentItemId: share.contentItemId,
      platform: share.platform,
      createdAt: share.createdAt,
    }));
  }

  /**
   * Legacy Post-oriented lookup.
   */
  async getUserPostShares(
    userId: string,
    postId: string,
  ): Promise<ShareResult[]> {
    const shares = await this.getUserContentItemShares(userId, postId);

    return shares.map((share) => ({
      id: share.id,
      userId: share.userId,
      postId: share.contentItemId,
      platform: share.platform,
      createdAt: share.createdAt,
    }));
  }
}

export const shareService = new ShareService();
