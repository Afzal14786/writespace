import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../../../db";

import {
  articles,
  contentItems,
  contentMentions,
  users,
} from "../../../db/schema";

import type { ContentDocument } from "../../../db/schema/content-document";

import type { CreateArticleInput } from "../dtos/create-article.dto";
import type { UpdateArticleInput } from "../dtos/update-article.dto";

import {
  ArticleStatus,
  type ArticleCoverImage,
} from "../interfaces/article.interface";

import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";

import logger from "@config/logger";

import {
  calculateArticleReadTime,
  collectArticleMentionedUserIds,
  extractArticleText,
  generateArticleExcerpt,
} from "../domain/article-content";

import {
  assertValidTransition,
  toArticleStatus,
} from "../domain/article-lifecycle";

import { generateArticleSlugCandidate } from "../domain/article-slug";

import { articleMediaService } from "./article-media.service";

import { addMediaCleanupJob } from "@shared/queues/media.queue";

/**
 * Article content must contain at least some readable content
 * before it can be published or scheduled.
 *
 * Empty drafts are permitted so authors can create an Article
 * and continue writing later.
 */
export interface CreateArticleData extends CreateArticleInput {
  coverImage?: ArticleCoverImage;
}

/**
 * Additional fields populated by the upload layer during updates.
 */
export interface UpdateArticleData extends UpdateArticleInput {
  coverImage?: ArticleCoverImage;
}

interface LifecycleState {
  status: ArticleStatus;
  scheduledAt: Date | null;
  publishDate: Date | null;
}

class ArticleCommandService {
  /**
   * Ensure the uploaded cover image belongs to the authenticated
   * user's Cloudinary upload directory.
   *
   * This follows the same upload ownership convention used by
   * the Posts module.
   */
  private assertCoverImageOwnedByUser(
    coverImage: ArticleCoverImage | undefined,
    userId: string,
  ): void {
    if (!coverImage) {
      return;
    }

    const userFolderPrefix = `uploads/users/${userId}/`;

    if (!coverImage.publicId.startsWith(userFolderPrefix)) {
      throw new AppError(
        HTTP_STATUS.FORBIDDEN,
        "You cannot attach a cover image that does not belong to your account",
      );
    }
  }

  /**
   * Ensure an Article contains actual content before it is scheduled
   * or published.
   *
   * The structured document may be empty while the Article is a draft.
   */
  private assertPublishableContent(document: ContentDocument): void {
    const readableContent = extractArticleText(document).trim();

    if (!readableContent) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "An Article must contain content before it can be scheduled or published",
      );
    }
  }

  /**
   * Validate lifecycle timestamps and resolve the resulting state.
   *
   * When updating an existing scheduled Article, an omitted scheduledAt
   * retains the existing schedule.
   *
   * Publishing records the actual publication time. Returning an Article
   * to draft clears both scheduling and publication timestamps.
   */
  private resolveLifecycleState(
    status: ArticleStatus,
    scheduledAtInput: string | null | undefined,
    currentState?: LifecycleState,
  ): LifecycleState {
    const now = new Date();

    if (status === ArticleStatus.SCHEDULED) {
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
          "A valid scheduledAt value is required for a scheduled Article",
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
        "scheduledAt can only be provided for a scheduled Article",
      );
    }

    if (status === ArticleStatus.PUBLISHED) {
      return {
        status,
        scheduledAt: null,

        // Preserve the original publication date when editing an
        // Article that is already published.
        publishDate:
          currentState?.status === ArticleStatus.PUBLISHED &&
          currentState.publishDate
            ? currentState.publishDate
            : now,
      };
    }

    return {
      status: ArticleStatus.DRAFT,
      scheduledAt: null,
      publishDate: null,
    };
  }

  /**
   * Check whether a slug is already being used by another Article.
   *
   * The database unique constraint remains the final protection against
   * concurrent requests attempting to create the same custom slug.
   */
  private async assertSlugAvailable(
    executor: Pick<typeof db, "select">,
    slug: string,
    currentArticleId?: string,
  ): Promise<void> {
    const conditions = [eq(articles.slug, slug)];

    if (currentArticleId) {
      // An Article may retain its own existing slug.
      conditions.push(sql`${articles.id} <> ${currentArticleId}`);
    }

    const [existingArticle] = await executor
      .select({
        id: articles.id,
      })
      .from(articles)
      .where(and(...conditions))
      .limit(1);

    if (existingArticle) {
      throw new AppError(
        HTTP_STATUS.CONFLICT,
        "An Article with this slug already exists",
      );
    }
  }

  /**
   * Check whether a database error represents a unique-constraint violation.
   *
   * This is used to translate a race condition on the unique slug index
   * into a meaningful API conflict response.
   */
  private isUniqueConstraintViolation(error: unknown): boolean {
    if (typeof error !== "object" || error === null || !("code" in error)) {
      return false;
    }

    return error.code === "23505";
  }

  /**
   * Queue cleanup for Cloudinary assets that are no longer referenced
   * by a committed Article record.
   *
   * Database transactions must commit before this method is called.
   */
  private async enqueueMediaCleanup(
    articleId: string,
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
        `Failed to enqueue Cloudinary cleanup for Article ${articleId}`,
        {
          error: err,
          publicIds: uniquePublicIds,
        },
      );
    }
  }

  /**
   * Create a new Article.
   *
   * The parent content_items record must be inserted before the
   * articles record because articles.id references content_items.id.
   *
   * All database operations are committed atomically.
   */
  public async createArticle(
    authorId: string,
    data: CreateArticleData,
  ): Promise<string> {
    const {
      title,
      subtitle,
      contentDocument,
      excerpt,
      tags,
      status,
      scheduledAt,
      slug: requestedSlug,
    } = data;

    try {
      /*
       * 1. Validate content and uploaded media ownership.
       */
      this.assertCoverImageOwnedByUser(data.coverImage, authorId);

      const nextStatus = toArticleStatus(status ?? ArticleStatus.DRAFT);

      if (
        nextStatus === ArticleStatus.PUBLISHED ||
        nextStatus === ArticleStatus.SCHEDULED
      ) {
        this.assertPublishableContent(contentDocument);
      }

      /*
       * 2. Resolve the Article lifecycle.
       */
      const lifecycle = this.resolveLifecycleState(nextStatus, scheduledAt);

      /*
       * 3. Generate the slug if the client did not supply one.
       *
       * A generated slug contains a UUID suffix.
       */
      const slug = requestedSlug ?? generateArticleSlugCandidate(title);

      /*
       * 4. Prepare derived Article information.
       */
      const generatedExcerpt = generateArticleExcerpt(contentDocument);

      const finalExcerpt =
        excerpt !== undefined ? excerpt : generatedExcerpt || null;

      const readTime = calculateArticleReadTime(contentDocument);

      const mentionedUserIds = collectArticleMentionedUserIds(contentDocument);

      const coverImageDbState = articleMediaService.toDatabase({
        coverImage: data.coverImage ?? null,
      });

      /*
       * 5. Persist the parent, Article, mentions and profile count
       *    within one transaction.
       */
      const articleId = await db.transaction(async (tx) => {
        // Validate the requested URL before attempting insertion.
        await this.assertSlugAvailable(tx, slug);

        // Every mention must reference a registered user.
        if (mentionedUserIds.length > 0) {
          const existingUsers = await tx
            .select({
              id: users.id,
            })
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
            contentType: "article",
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
            "Failed to create Article content item",
          );
        }

        const articleId = createdContentItem.id;

        await tx.insert(articles).values({
          id: articleId,
          title,
          slug,
          subtitle: subtitle ?? null,
          contentDocument,
          excerpt: finalExcerpt,
          tags: tags ?? [],
          readTime,

          ...coverImageDbState,
        });

        // Store unique mentioned users for lookup and notification creation.
        if (mentionedUserIds.length > 0) {
          await tx.insert(contentMentions).values(
            mentionedUserIds.map((mentionedUserId) => ({
              contentItemId: articleId,
              mentionedUserId,
            })),
          );
        }

        /*
         * Preserve the existing profile-counter behavior from Posts:
         * a newly created content item increments totalPosts.
         *
         * This currently treats Posts and Articles as authored content
         * for this counter. We should verify this intended meaning during
         * the final cross-module integration review.
         */
        await tx
          .update(users)
          .set({
            totalPosts: sql`${users.totalPosts} + 1`,
          })
          .where(eq(users.id, authorId));

        return articleId;
      });

      return articleId;
    } catch (error) {
      /*
       * The cover image is uploaded before the database transaction.
       * If Article creation fails, queue its removal to avoid leaving
       * an unreferenced Cloudinary asset.
       */
      if (data.coverImage?.publicId) {
        await this.enqueueMediaCleanup("failed-article-create", [
          data.coverImage.publicId,
        ]);
      }

      if (this.isUniqueConstraintViolation(error)) {
        throw new AppError(
          HTTP_STATUS.CONFLICT,
          "An Article with this slug already exists",
        );
      }

      throw error;
    }
  }

  /**
   * Update an existing Article.
   *
   * Partial updates are supported. Omitted fields retain their current
   * values.
   *
   * The parent content_items.version is used for optimistic concurrency
   * so simultaneous edits cannot silently overwrite each other.
   */
  public async updateArticle(
    articleId: string,
    userId: string,
    data: UpdateArticleData,
  ): Promise<string> {
    try {
      const result = await db.transaction(async (tx) => {
        /*
         * 1. Load the shared content record and Article-specific record.
         */
        const [record] = await tx
          .select({
            contentItem: contentItems,
            article: articles,
          })
          .from(contentItems)
          .innerJoin(articles, eq(articles.id, contentItems.id))
          .where(
            and(
              eq(contentItems.id, articleId),
              eq(contentItems.contentType, "article"),
            ),
          )
          .limit(1);

        if (!record) {
          throw new AppError(HTTP_STATUS.NOT_FOUND, "Article not found");
        }

        const { contentItem, article } = record;

        /*
         * 2. Verify ownership.
         */
        if (contentItem.authorId !== userId) {
          throw new AppError(
            HTTP_STATUS.FORBIDDEN,
            "You are not authorized to edit this Article",
          );
        }

        /*
         * 3. Resolve and validate the lifecycle transition.
         */
        const currentStatus = toArticleStatus(contentItem.status);

        const nextStatus =
          data.status === undefined
            ? currentStatus
            : toArticleStatus(data.status);

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

        /*
         * 4. Resolve the next content document.
         */
        const nextContentDocument =
          data.contentDocument ?? article.contentDocument;

        const contentDocumentChanged =
          data.contentDocument !== undefined &&
          JSON.stringify(data.contentDocument) !==
            JSON.stringify(article.contentDocument);

        if (
          nextStatus === ArticleStatus.PUBLISHED ||
          nextStatus === ArticleStatus.SCHEDULED
        ) {
          this.assertPublishableContent(nextContentDocument);
        }

        /*
         * 5. Resolve Article slug changes.
         *
         * Changing the title alone does not alter the existing slug.
         * Explicit slug changes are allowed for drafts and scheduled
         * Articles.
         *
         * Published Article slugs are kept immutable for now because
         * a permanent redirect system has not yet been implemented.
         */
        let nextSlug = article.slug;

        if (data.slug !== undefined && data.slug !== article.slug) {
          if (currentStatus === ArticleStatus.PUBLISHED) {
            throw new AppError(
              HTTP_STATUS.BAD_REQUEST,
              "Published Article slugs cannot be changed until URL redirects are supported",
            );
          }

          await this.assertSlugAvailable(tx, data.slug, articleId);

          nextSlug = data.slug;
        }

        /*
         * 6. Resolve the next cover-image state.
         */
        const previousCoverImage = articleMediaService.fromDatabase(
          article.coverImageUrl,
          article.coverImagePublicId,
          article.coverImageAltText,
          article.coverImageCredit,
        ).coverImage;

        if (data.removeCoverImage && data.coverImage) {
          throw new AppError(
            HTTP_STATUS.BAD_REQUEST,
            "A cover image cannot be uploaded and removed in the same update",
          );
        }

        this.assertCoverImageOwnedByUser(data.coverImage, userId);

        let nextCoverImage: ArticleCoverImage | null = previousCoverImage;

        if (data.removeCoverImage === true) {
          nextCoverImage = null;
        } else if (data.coverImage) {
          // A replacement image gets its own metadata. Do not silently
          // inherit the previous image's alt text or attribution.
          nextCoverImage = articleMediaService.createCoverImage(
            data.coverImage.url,
            data.coverImage.publicId,
            data.coverImageAltText ?? data.coverImage.altText ?? null,
            data.coverImageCredit ?? data.coverImage.credit ?? null,
          );
        } else if (previousCoverImage) {
          // Metadata can be updated without replacing the actual asset.
          nextCoverImage = {
            ...previousCoverImage,

            altText:
              data.coverImageAltText !== undefined
                ? data.coverImageAltText
                : previousCoverImage.altText,

            credit:
              data.coverImageCredit !== undefined
                ? data.coverImageCredit
                : previousCoverImage.credit,
          };
        } else if (
          data.coverImageAltText !== undefined ||
          data.coverImageCredit !== undefined
        ) {
          throw new AppError(
            HTTP_STATUS.BAD_REQUEST,
            "Cover image metadata cannot be updated without a cover image",
          );
        }

        const coverImageDiff = articleMediaService.diff(
          previousCoverImage,
          nextCoverImage,
        );

        /*
         * 7. Resolve excerpt and reading time.
         */
        let nextExcerpt = article.excerpt;

        if (data.excerpt !== undefined) {
          // Explicit null or text takes precedence over automatic generation.
          nextExcerpt = data.excerpt;
        } else if (contentDocumentChanged) {
          // Regenerate the excerpt if content changes and the caller
          // did not provide an explicit replacement excerpt.
          nextExcerpt = generateArticleExcerpt(nextContentDocument) || null;
        }

        const nextReadTime = contentDocumentChanged
          ? calculateArticleReadTime(nextContentDocument)
          : article.readTime;

        /*
         * 8. Resolve the next Article-specific fields.
         */
        const nextTitle = data.title ?? article.title;
        const nextSubtitle =
          data.subtitle !== undefined ? data.subtitle : article.subtitle;

        const nextTags = data.tags ?? article.tags;

        const titleChanged = nextTitle !== article.title;
        const subtitleChanged = nextSubtitle !== article.subtitle;

        const tagsChanged =
          JSON.stringify(nextTags) !== JSON.stringify(article.tags);

        const slugChanged = nextSlug !== article.slug;
        const excerptChanged = nextExcerpt !== article.excerpt;
        const readTimeChanged = nextReadTime !== article.readTime;

        const scheduleChanged =
          nextLifecycle.scheduledAt?.getTime() !==
          currentLifecycle.scheduledAt?.getTime();

        const publishDateChanged =
          nextLifecycle.publishDate?.getTime() !==
          currentLifecycle.publishDate?.getTime();

        const statusChanged = nextLifecycle.status !== currentStatus;

        /*
         * Nothing changed: avoid unnecessarily incrementing the version.
         */
        const hasChanges =
          titleChanged ||
          subtitleChanged ||
          tagsChanged ||
          slugChanged ||
          excerptChanged ||
          readTimeChanged ||
          contentDocumentChanged ||
          coverImageDiff.changed ||
          statusChanged ||
          scheduleChanged ||
          publishDateChanged;

        if (!hasChanges) {
          return {
            cleanupPublicIds: [] as string[],
          };
        }

        /*
         * 9. Validate new mentions before writing any changes.
         */
        let nextMentionedUserIds: string[] | undefined;

        if (contentDocumentChanged) {
          nextMentionedUserIds =
            collectArticleMentionedUserIds(nextContentDocument);

          if (nextMentionedUserIds.length > 0) {
            const existingUsers = await tx
              .select({
                id: users.id,
              })
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
         * 10. Update the shared content item first.
         *
         * This version check is the concurrency guard for the entire
         * Article update. If another update has already committed,
         * this transaction rolls back.
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
              eq(contentItems.id, articleId),
              eq(contentItems.version, contentItem.version),
            ),
          )
          .returning({
            id: contentItems.id,
          });

        if (!updatedContentItem) {
          throw new AppError(
            HTTP_STATUS.CONFLICT,
            "Article was modified by another request. Please refresh and try again.",
          );
        }

        /*
         * 11. Update Article-specific columns.
         */
        const articleUpdates: Partial<typeof articles.$inferInsert> = {};

        if (titleChanged) {
          articleUpdates.title = nextTitle;
        }

        if (subtitleChanged) {
          articleUpdates.subtitle = nextSubtitle;
        }

        if (slugChanged) {
          articleUpdates.slug = nextSlug;
        }

        if (contentDocumentChanged) {
          articleUpdates.contentDocument = nextContentDocument;
        }

        if (excerptChanged) {
          articleUpdates.excerpt = nextExcerpt;
        }

        if (tagsChanged) {
          articleUpdates.tags = nextTags;
        }

        if (readTimeChanged) {
          articleUpdates.readTime = nextReadTime;
        }

        if (coverImageDiff.changed) {
          const coverImageDbState = articleMediaService.toDatabase({
            coverImage: nextCoverImage,
          });

          Object.assign(articleUpdates, coverImageDbState);
        }

        if (Object.keys(articleUpdates).length > 0) {
          await tx
            .update(articles)
            .set(articleUpdates)
            .where(eq(articles.id, articleId));
        }

        /*
         * 12. Synchronize mention lookup rows when the document changes.
         */
        if (nextMentionedUserIds !== undefined) {
          await tx
            .delete(contentMentions)
            .where(eq(contentMentions.contentItemId, articleId));

          if (nextMentionedUserIds.length > 0) {
            await tx.insert(contentMentions).values(
              nextMentionedUserIds.map((mentionedUserId) => ({
                contentItemId: articleId,
                mentionedUserId,
              })),
            );
          }
        }

        /*
         * 13. Collect old cover-image assets.
         *
         * Cloudinary cleanup must happen only after this transaction commits.
         */
        return {
          cleanupPublicIds:
            articleMediaService.getRemovedPublicIds(coverImageDiff),
        };
      });

      /*
       * Database transaction committed successfully.
       * Now queue removal of old cover-image assets.
       */
      await this.enqueueMediaCleanup(articleId, result.cleanupPublicIds);

      return articleId;
    } catch (error) {
      /*
       * A newly uploaded cover image that was not committed to the
       * database should not remain orphaned in Cloudinary.
       *
       * Compare it against the current Article cover before queueing
       * cleanup, to avoid deleting an asset that is still referenced.
       */
      if (data.coverImage?.publicId) {
        try {
          const [currentArticle] = await db
            .select({
              coverImagePublicId: articles.coverImagePublicId,
            })
            .from(articles)
            .where(eq(articles.id, articleId))
            .limit(1);

          if (currentArticle?.coverImagePublicId !== data.coverImage.publicId) {
            await this.enqueueMediaCleanup(articleId, [
              data.coverImage.publicId,
            ]);
          }
        } catch (cleanupError: unknown) {
          logger.error(
            `Unable to inspect failed cover upload for Article ${articleId}`,
            {
              error: cleanupError,
              publicId: data.coverImage.publicId,
            },
          );
        }
      }

      if (this.isUniqueConstraintViolation(error)) {
        throw new AppError(
          HTTP_STATUS.CONFLICT,
          "An Article with this slug already exists",
        );
      }

      throw error;
    }
  }

  /**
   * Permanently delete an Article.
   *
   * Deleting the parent content_items row cascades to:
   * - articles
   * - content_mentions
   * - reactions
   * - saves
   * - shares
   * - comments and their reactions
   *
   * The cover image's Cloudinary public ID is captured before deletion.
   * Cloudinary cleanup is queued after the database transaction commits.
   */
  public async deleteArticle(articleId: string, userId: string): Promise<void> {
    const coverImagePublicId = await db.transaction(async (tx) => {
      const [record] = await tx
        .select({
          contentItem: contentItems,
          article: articles,
        })
        .from(contentItems)
        .innerJoin(articles, eq(articles.id, contentItems.id))
        .where(
          and(
            eq(contentItems.id, articleId),
            eq(contentItems.contentType, "article"),
          ),
        )
        .limit(1);

      if (!record) {
        throw new AppError(HTTP_STATUS.NOT_FOUND, "Article not found");
      }

      if (record.contentItem.authorId !== userId) {
        throw new AppError(
          HTTP_STATUS.FORBIDDEN,
          "You are not authorized to delete this Article",
        );
      }

      // Capture the external asset identifier before cascading deletion.
      const publicId = record.article.coverImagePublicId;

      // The parent deletion removes the Article and dependent records.
      await tx
        .delete(contentItems)
        .where(
          and(
            eq(contentItems.id, articleId),
            eq(contentItems.contentType, "article"),
          ),
        );

      // Keep the existing content counter consistent with Posts.
      await tx
        .update(users)
        .set({
          totalPosts: sql`GREATEST(${users.totalPosts} - 1, 0)`,
        })
        .where(eq(users.id, record.contentItem.authorId));

      return publicId;
    });

    // Queue Cloudinary cleanup after the database commit.
    if (coverImagePublicId) {
      await this.enqueueMediaCleanup(articleId, [coverImagePublicId]);
    }
  }
}

export const articleCommandService = new ArticleCommandService();
