import type { NewPostMedia, PostMedia } from "../../../db/schema";

import type { PostMediaItem } from "../interfaces/post.interface";

import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";

export const MAX_POST_MEDIA = 5;

export interface PostMediaDiff {
  /** Existing attachments that will remain on the Post. */
  keptMedia: PostMedia[];

  /** Newly uploaded attachments that need database records. */
  addedMedia: PostMediaItem[];

  /** Existing attachments that will be removed. */
  removedMedia: PostMedia[];
}

class PostMediaService {
  /**
   * Convert database records into an ordered media collection.
   *
   * A database row can have a null publicId because the schema allows
   * attachments that are not managed by Cloudinary.
   */
  public fromDatabase(media: PostMedia[] | null | undefined): PostMedia[] {
    const records = [...(media ?? [])].sort(
      (first, second) => first.position - second.position,
    );

    for (const item of records) {
      this.assertValidDatabaseItem(item);
    }

    return records;
  }

  /**
   * Build a media item from the upload layer.
   *
   * Newly uploaded Cloudinary media must have a publicId so that
   * the application can delete the asset when its attachment is removed.
   */
  public createMediaItem(
    url: string,
    publicId: string,
    altText?: string | null,
  ): PostMediaItem {
    const item: PostMediaItem = {
      url,
      publicId,
      ...(altText !== undefined ? { altText } : {}),
    };

    this.assertValidMediaItem(item);

    return item;
  }

  /**
   * Validate a collection of newly uploaded media.
   *
   * This enforces the maximum of five attachments and prevents the same
   * Cloudinary asset from being attached more than once.
   */
  public validateMedia(media: PostMediaItem[]): void {
    if (media.length > MAX_POST_MEDIA) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        `A Post can have a maximum of ${MAX_POST_MEDIA} images`,
      );
    }

    const publicIds = new Set<string>();

    for (const item of media) {
      this.assertValidMediaItem(item);

      if (publicIds.has(item.publicId)) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "Duplicate media attachment detected",
        );
      }

      publicIds.add(item.publicId);
    }
  }

  /**
   * Calculate the result of removing existing attachments and adding
   * newly uploaded attachments.
   *
   * Existing records are identified by their database IDs, not by
   * Cloudinary publicIds. This is important because publicId is nullable
   * in the database and is an external storage identifier.
   */
  public diff(
    previousMedia: PostMedia[],
    addedMedia: PostMediaItem[],
    removeMediaIds: string[] = [],
  ): PostMediaDiff {
    const removeIds = new Set(removeMediaIds);

    if (removeIds.size !== removeMediaIds.length) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Duplicate media IDs were provided for removal",
      );
    }

    const existingIds = new Set(previousMedia.map((item) => item.id));

    for (const id of removeIds) {
      if (!existingIds.has(id)) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "One or more media attachments do not belong to this Post",
        );
      }
    }

    this.validateMedia(addedMedia);

    const keptMedia = previousMedia.filter((item) => !removeIds.has(item.id));

    const removedMedia = previousMedia.filter((item) => removeIds.has(item.id));

    if (keptMedia.length + addedMedia.length > MAX_POST_MEDIA) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        `A Post can have a maximum of ${MAX_POST_MEDIA} images`,
      );
    }

    return {
      keptMedia,
      addedMedia,
      removedMedia,
    };
  }

  /**
   * Convert newly uploaded media into database insert records.
   *
   * `startingPosition` allows the command service to append new
   * attachments after the existing ones.
   */
  public toDatabase(
    postId: string,
    media: PostMediaItem[],
    startingPosition = 0,
  ): NewPostMedia[] {
    if (!postId.trim()) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Post ID is required when creating media records",
      );
    }

    if (!Number.isInteger(startingPosition) || startingPosition < 0) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Media position must be a non-negative integer",
      );
    }

    this.validateMedia(media);

    return media.map((item, index) => ({
      postId,
      url: item.url,
      publicId: item.publicId,
      altText: item.altText ?? null,
      position: startingPosition + index,
    }));
  }

  /**
   * Return Cloudinary publicIds for assets that should be deleted
   * after their database records have been successfully removed.
   *
   * Records without a publicId are intentionally skipped because
   * they are not associated with a Cloudinary asset.
   */
  public getRemovedPublicIds(diff: PostMediaDiff): string[] {
    return [
      ...new Set(
        diff.removedMedia
          .map((item) => item.publicId)
          .filter((publicId): publicId is string => Boolean(publicId)),
      ),
    ];
  }

  private assertValidMediaItem(item: PostMediaItem): void {
    if (!item.url?.trim()) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Media URL is required");
    }

    if (!item.publicId?.trim()) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Media publicId is required for uploaded media",
      );
    }

    let parsedUrl: URL;

    try {
      parsedUrl = new URL(item.url);
    } catch {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Media URL must be a valid HTTP or HTTPS URL",
      );
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Media URL must use HTTP or HTTPS",
      );
    }

    if (
      item.publicId.startsWith("http://") ||
      item.publicId.startsWith("https://")
    ) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Media publicId must not be a URL",
      );
    }
  }

  /**
   * Validate a persisted row. Unlike a newly uploaded item, a database
   * record is allowed to have a null publicId.
   */
  private assertValidDatabaseItem(item: PostMedia): void {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(item.url);
    } catch {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        `Invalid media URL stored for attachment ${item.id}`,
      );
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        `Invalid media URL stored for attachment ${item.id}`,
      );
    }

    if (!Number.isInteger(item.position) || item.position < 0) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        `Invalid media position stored for attachment ${item.id}`,
      );
    }
  }
}

export const postMediaService = new PostMediaService();
