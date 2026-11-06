import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../../../db";
import {
  contentItems,
  contentMentions,
  postMedia,
  posts,
  users,
} from "../../../db/schema";

import type { ContentDocument } from "../../../db/schema/content-document";

import type { CreatePostInput } from "../dtos/create-post.dto";
import type { UpdatePostDto } from "../dtos/update-post.dto";

import { PostStatus, type PostMediaItem } from "../interfaces/post.interface";

import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import logger from "@config/logger";

import {
  collectMentionedUserIds,
  countContentDocumentCharacters,
} from "../domain/post-content";

import { assertValidTransition, toPostStatus } from "../domain/post-lifecycle";

import { postMediaService } from "./post-media.service";
import { addMediaCleanupJob } from "@shared/queues/media.queue";

const MAX_POST_CHARACTERS = 6000;

export interface CreatePostData extends CreatePostInput {
  /** Images freshly uploaded through the authenticated upload flow. */
  media?: PostMediaItem[];
}

export interface UpdatePostData extends UpdatePostDto {
  /** Images freshly uploaded through the authenticated upload flow. */
  media?: PostMediaItem[];

  /** Database IDs of existing attachments the user wants to remove. */
  removeMediaIds?: string[];
}

interface LifecycleState {
  status: PostStatus;
  scheduledAt: Date | null;
  publishDate: Date | null;
}

class PostCommandService {
  /**
   * Only allow newly uploaded assets from the authenticated user's
   * Cloudinary folder to be attached to their Post.
   *
   * Retained media is loaded from the database. The client cannot replace
   * an existing asset's URL or Cloudinary publicId.
   */
  private assertMediaOwnedByUser(items: PostMediaItem[], userId: string): void {
    const userFolderPrefix = `uploads/users/${userId}/`;

    for (const item of items) {
      if (!item.publicId.startsWith(userFolderPrefix)) {
        throw new AppError(
          HTTP_STATUS.FORBIDDEN,
          "You cannot attach media that does not belong to your account",
        );
      }
    }
  }

  /**
   * Enforce the document limit at the service boundary as well as in the DTO.
   */
  private assertValidContentDocument(document: ContentDocument): void {
    const characterCount = countContentDocumentCharacters(document);

    if (characterCount > MAX_POST_CHARACTERS) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        `Post content cannot exceed ${MAX_POST_CHARACTERS} characters`,
      );
    }
  }

  /**
   * Resolve and validate lifecycle timestamps for a new or updated Post.
   */
  private resolveLifecycleState(
    status: PostStatus,
    scheduledAtInput: string | null | undefined,
    currentState?: LifecycleState,
  ): LifecycleState {
    const now = new Date();

    if (status === PostStatus.SCHEDULED) {
      let scheduledAt: Date | null;

      if (scheduledAtInput === undefined) {
        scheduledAt = currentState?.scheduledAt ?? null;
      } else if (scheduledAtInput === null) {
        scheduledAt = null;
      } else {
        scheduledAt = new Date(scheduledAtInput);
      }

      if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "A valid scheduledAt value is required for a scheduled Post",
        );
      }

      if (scheduledAt <= now) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "scheduledAt must be in the future",
        );
      }

      return {
        status,
        scheduledAt,
        publishDate: null,
      };
    }

    if (scheduledAtInput != null) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "scheduledAt can only be provided for a scheduled Post",
      );
    }

    if (status === PostStatus.PUBLISHED) {
      return {
        status,
        scheduledAt: null,
        publishDate:
          currentState?.status === PostStatus.PUBLISHED &&
          currentState.publishDate
            ? currentState.publishDate
            : now,
      };
    }

    return {
      status: PostStatus.DRAFT,
      scheduledAt: null,
      publishDate: null,
    };
  }

  /**
   * Create a new Post.
   *
   * The parent content_items record is inserted first because posts.id
   * references content_items.id and does not generate its own UUID.
   *
   * All database writes happen in one transaction so a partially-created
   * Post cannot be left behind.
   */
  public async createPost(
    authorId: string,
    data: CreatePostData,
  ): Promise<string> {
    const contentDocument = data.contentDocument;
    const media = data.media ?? [];

    this.assertValidContentDocument(contentDocument);

    postMediaService.validateMedia(media);
    this.assertMediaOwnedByUser(media, authorId);

    const status = toPostStatus(data.status ?? PostStatus.DRAFT);

    const lifecycle = this.resolveLifecycleState(status, data.scheduledAt);

    const mentionedUserIds = collectMentionedUserIds(contentDocument);

    try {
      const postId = await db.transaction(async (tx) => {
        // Confirm every mention points to a registered user.
        if (mentionedUserIds.length > 0) {
          const existingUsers = await tx
            .select({ id: users.id })
            .from(users)
            .where(inArray(users.id, mentionedUserIds));

          if (existingUsers.length !== mentionedUserIds.length) {
            throw new AppError(
              HTTP_STATUS.BAD_REQUEST,
              "One or more mentioned users do not exist",
            );
          }
        }

        const [createdContentItem] = await tx
          .insert(contentItems)
          .values({
            contentType: "post",
            authorId,
            status: lifecycle.status,
            scheduledAt: lifecycle.scheduledAt,
            publishDate: lifecycle.publishDate,
          })
          .returning({
            id: contentItems.id,
          });

        if (!createdContentItem) {
          throw new AppError(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            "Failed to create the Post content item",
          );
        }

        const postId = createdContentItem.id;

        await tx.insert(posts).values({
          id: postId,
          contentDocument,
          tags: data.tags ?? [],
        });

        // Every attachment is stored as its own ordered database row.
        const mediaRecords = postMediaService.toDatabase(postId, media);

        if (mediaRecords.length > 0) {
          await tx.insert(postMedia).values(mediaRecords);
        }

        // Store one mention row per unique mentioned user.
        if (mentionedUserIds.length > 0) {
          await tx.insert(contentMentions).values(
            mentionedUserIds.map((mentionedUserId) => ({
              contentItemId: postId,
              mentionedUserId,
            })),
          );
        }

        // Preserve the existing counter behavior for newly-created Posts.
        await tx
          .update(users)
          .set({
            totalPosts: sql`${users.totalPosts} + 1`,
          })
          .where(eq(users.id, authorId));

        return postId;
      });

      return postId;
    } catch (error) {
      /*
       * Uploads happen before the database transaction.
       * If creation fails, those files are not attached to a Post.
       * Queue them for cleanup so they do not become orphaned assets.
       */
      await this.enqueueMediaCleanup(
        "failed-post-create",
        media.map((item) => item.publicId),
      );

      throw error;
    }
  }

  /**
   * Update an existing Post.
   *
   * Only fields supplied by the caller are changed. Omitted fields retain
   * their current values.
   *
   * The content_items version is updated first inside the transaction.
   * If another request has already changed the Post, the transaction fails
   * before its Post, media, or mention rows can be modified.
   */
  public async updatePost(
    postId: string,
    userId: string,
    data: UpdatePostData,
  ): Promise<string> {
    try {
      const result = await db.transaction(async (tx) => {
        const [record] = await tx
          .select({
            contentItem: contentItems,
            post: posts,
          })
          .from(contentItems)
          .innerJoin(posts, eq(posts.id, contentItems.id))
          .where(
            and(
              eq(contentItems.id, postId),
              eq(contentItems.contentType, "post"),
            ),
          )
          .limit(1);

        if (!record) {
          throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
        }

        const { contentItem, post } = record;

        if (contentItem.authorId !== userId) {
          throw new AppError(
            HTTP_STATUS.FORBIDDEN,
            "You are not authorized to edit this Post",
          );
        }

        const currentStatus = toPostStatus(contentItem.status);

        const nextStatus =
          data.status === undefined ? currentStatus : toPostStatus(data.status);

        assertValidTransition(currentStatus, nextStatus);

        const currentLifecycle: LifecycleState = {
          status: currentStatus,
          scheduledAt: contentItem.scheduledAt,
          publishDate: contentItem.publishDate,
        };

        const nextLifecycle = this.resolveLifecycleState(
          nextStatus,
          data.scheduledAt,
          currentLifecycle,
        );

        const contentDocumentChanged =
          data.contentDocument !== undefined &&
          JSON.stringify(data.contentDocument) !==
            JSON.stringify(post.contentDocument);

        const tagsChanged =
          data.tags !== undefined &&
          JSON.stringify(data.tags) !== JSON.stringify(post.tags);

        if (data.contentDocument !== undefined) {
          this.assertValidContentDocument(data.contentDocument);
        }

        /*
         * Load existing media from the database. The client supplies database
         * IDs for removal, not replacement URL/publicId pairs.
         */
        const currentMedia = postMediaService.fromDatabase(
          await tx
            .select()
            .from(postMedia)
            .where(eq(postMedia.postId, postId))
            .orderBy(asc(postMedia.position)),
        );

        const newlyUploadedMedia = data.media ?? [];

        postMediaService.validateMedia(newlyUploadedMedia);
        this.assertMediaOwnedByUser(newlyUploadedMedia, userId);

        const mediaDiff = postMediaService.diff(
          currentMedia,
          newlyUploadedMedia,
          data.removeMediaIds ?? [],
        );

        // Prevent an existing retained asset from being attached again
        // as a newly uploaded image.
        const retainedPublicIds = new Set(
          mediaDiff.keptMedia
            .map((item) => item.publicId)
            .filter((id): id is string => Boolean(id)),
        );

        for (const item of mediaDiff.addedMedia) {
          if (retainedPublicIds.has(item.publicId)) {
            throw new AppError(
              HTTP_STATUS.BAD_REQUEST,
              "This image is already attached to the Post",
            );
          }
        }

        const mediaChanged =
          mediaDiff.addedMedia.length > 0 || mediaDiff.removedMedia.length > 0;

        const scheduleChanged =
          nextLifecycle.scheduledAt?.getTime() !==
          currentLifecycle.scheduledAt?.getTime();

        const publishDateChanged =
          nextLifecycle.publishDate?.getTime() !==
          currentLifecycle.publishDate?.getTime();

        const statusChanged = nextLifecycle.status !== currentStatus;

        const hasChanges =
          contentDocumentChanged ||
          tagsChanged ||
          mediaChanged ||
          scheduleChanged ||
          publishDateChanged ||
          statusChanged;

        if (!hasChanges) {
          return {
            cleanupPublicIds: [] as string[],
          };
        }

        /*
         * Validate the new mention set before making any writes.
         * If the document did not change, keep the existing mention rows.
         */
        let nextMentionedUserIds: string[] | undefined;

        if (contentDocumentChanged && data.contentDocument) {
          nextMentionedUserIds = collectMentionedUserIds(data.contentDocument);

          if (nextMentionedUserIds.length > 0) {
            const existingUsers = await tx
              .select({ id: users.id })
              .from(users)
              .where(inArray(users.id, nextMentionedUserIds));

            if (existingUsers.length !== nextMentionedUserIds.length) {
              throw new AppError(
                HTTP_STATUS.BAD_REQUEST,
                "One or more mentioned users do not exist",
              );
            }
          }
        }

        /*
         * Optimistic concurrency:
         * only one request based on this version can successfully update
         * the Post. A conflict rolls back the entire transaction.
         */
        const [updatedContentItem] = await tx
          .update(contentItems)
          .set({
            status: nextLifecycle.status,
            scheduledAt: nextLifecycle.scheduledAt,
            publishDate: nextLifecycle.publishDate,
            version: sql`${contentItems.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(contentItems.id, postId),
              eq(contentItems.version, contentItem.version),
            ),
          )
          .returning({
            id: contentItems.id,
          });

        if (!updatedContentItem) {
          throw new AppError(
            HTTP_STATUS.CONFLICT,
            "Post was modified by another request. Please refresh and try again.",
          );
        }

        // Update Post-specific data separately from shared content data.
        const postUpdates: Partial<typeof posts.$inferInsert> = {};

        if (contentDocumentChanged && data.contentDocument) {
          postUpdates.contentDocument = data.contentDocument;
        }

        if (tagsChanged && data.tags !== undefined) {
          postUpdates.tags = data.tags;
        }

        if (Object.keys(postUpdates).length > 0) {
          await tx.update(posts).set(postUpdates).where(eq(posts.id, postId));
        }

        // Synchronize mention lookup rows only when the document changes.
        if (nextMentionedUserIds !== undefined) {
          await tx
            .delete(contentMentions)
            .where(eq(contentMentions.contentItemId, postId));

          if (nextMentionedUserIds.length > 0) {
            await tx.insert(contentMentions).values(
              nextMentionedUserIds.map((mentionedUserId) => ({
                contentItemId: postId,
                mentionedUserId,
              })),
            );
          }
        }

        /*
         * Synchronize media records if attachments were added or removed.
         *
         * Existing media IDs are preserved. Positions are temporarily moved
         * above the current range before being compacted to 0..N-1. This
         * avoids collisions with the unique (postId, position) index.
         */
        if (mediaChanged) {
          if (mediaDiff.removedMedia.length > 0) {
            await tx.delete(postMedia).where(
              inArray(
                postMedia.id,
                mediaDiff.removedMedia.map((item) => item.id),
              ),
            );
          }

          const maxCurrentPosition = currentMedia.reduce(
            (max, item) => Math.max(max, item.position),
            -1,
          );

          const temporaryOffset = maxCurrentPosition + 10;

          for (const [index, item] of mediaDiff.keptMedia.entries()) {
            await tx
              .update(postMedia)
              .set({
                position: temporaryOffset + index,
              })
              .where(eq(postMedia.id, item.id));
          }

          for (const [index, item] of mediaDiff.keptMedia.entries()) {
            await tx
              .update(postMedia)
              .set({
                position: index,
              })
              .where(eq(postMedia.id, item.id));
          }

          const newMediaRecords = postMediaService.toDatabase(
            postId,
            mediaDiff.addedMedia,
            mediaDiff.keptMedia.length,
          );

          if (newMediaRecords.length > 0) {
            await tx.insert(postMedia).values(newMediaRecords);
          }
        }

        return {
          cleanupPublicIds: postMediaService.getRemovedPublicIds(mediaDiff),
        };
      });

      // Queue removal of old assets only after the transaction commits.
      await this.enqueueMediaCleanup(postId, result.cleanupPublicIds);

      return postId;
    } catch (error) {
      /*
       * These are newly uploaded files from this update request.
       * If the transaction fails, they were never attached to the Post.
       */
      await this.enqueueMediaCleanup(
        postId,
        (data.media ?? []).map((item) => item.publicId),
      );

      throw error;
    }
  }

  /**
   * Permanently delete a Post.
   *
   * The content_items row is the root record. Its foreign-key cascades
   * remove the matching posts row, post_media, mentions, reactions, saves,
   * shares, comments, and comment reactions.
   *
   * Only the Post owner can perform this operation.
   */
  public async deletePost(postId: string, userId: string): Promise<void> {
    const mediaPublicIds = await db.transaction(async (tx) => {
      const [contentItem] = await tx
        .select()
        .from(contentItems)
        .where(
          and(
            eq(contentItems.id, postId),
            eq(contentItems.contentType, "post"),
          ),
        )
        .limit(1);

      if (!contentItem) {
        throw new AppError(HTTP_STATUS.NOT_FOUND, "Post not found");
      }

      if (contentItem.authorId !== userId) {
        throw new AppError(
          HTTP_STATUS.FORBIDDEN,
          "You are not authorized to delete this Post",
        );
      }

      // Capture Cloudinary identifiers before the FK cascade removes media rows.
      const mediaRecords = await tx
        .select({
          publicId: postMedia.publicId,
        })
        .from(postMedia)
        .where(eq(postMedia.postId, postId));

      const publicIds = [
        ...new Set(
          mediaRecords
            .map((item) => item.publicId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];

      // Deleting the parent row cascades through the Post and its relations.
      await tx
        .delete(contentItems)
        .where(
          and(
            eq(contentItems.id, postId),
            eq(contentItems.contentType, "post"),
          ),
        );

      // Prevent the denormalized counter from becoming negative.
      await tx
        .update(users)
        .set({
          totalPosts: sql`GREATEST(${users.totalPosts} - 1, 0)`,
        })
        .where(eq(users.id, contentItem.authorId));

      return publicIds;
    });

    /*
     * The database deletion has committed at this point.
     * Queue every Cloudinary asset attached to this Post for deletion.
     */
    await this.enqueueMediaCleanup(postId, mediaPublicIds);
  }

  /**
   * Queue Cloudinary asset cleanup.
   *
   * The queue has retry/backoff settings. A queue submission failure is
   * logged instead of being thrown after a database transaction has already
   * committed.
   */
  private async enqueueMediaCleanup(
    resourceId: string,
    publicIds: string[],
  ): Promise<void> {
    const uniquePublicIds = [
      ...new Set(
        publicIds.filter(
          (publicId) =>
            typeof publicId === "string" && publicId.trim().length > 0,
        ),
      ),
    ];

    if (uniquePublicIds.length === 0) {
      return;
    }

    try {
      await addMediaCleanupJob(uniquePublicIds);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));

      logger.error(
        `Failed to enqueue Cloudinary cleanup for content ${resourceId}`,
        {
          error: err,
          publicIds: uniquePublicIds,
        },
      );
    }
  }
}

export const postCommandService = new PostCommandService();
