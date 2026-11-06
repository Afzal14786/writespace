import type { ArticleCoverImage } from "../interfaces/article.interface";

import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";

/**
 * Application representation of an Article's cover image.
 *
 * A cover image is optional, but when present it must contain
 * a valid URL and its Cloudinary public ID.
 */
export interface ArticleMediaState {
  coverImage: ArticleCoverImage | null;
}

/**
 * Database representation of an Article's cover image.
 *
 * These fields map to the corresponding nullable columns
 * in the articles table.
 */
export interface ArticleMediaDbState {
  coverImageUrl: string | null;
  coverImagePublicId: string | null;
  coverImageAltText: string | null;
  coverImageCredit: string | null;
}

/**
 * Describes the difference between the previous and new
 * cover-image states.
 */
export interface ArticleMediaDiff {
  oldCoverImage: ArticleCoverImage | null;
  newCoverImage: ArticleCoverImage | null;

  /** Whether the database representation needs to change. */
  changed: boolean;

  /** Whether the underlying Cloudinary asset has changed. */
  assetChanged: boolean;
}

class ArticleMediaService {
  /**
   * Reconstruct the application representation from database fields.
   *
   * A completely empty set of fields means the Article has no cover.
   *
   * A partially populated cover-image record is considered inconsistent
   * and is treated as a server-side data integrity error.
   */
  public fromDatabase(
    coverImageUrl: string | null | undefined,
    coverImagePublicId: string | null | undefined,
    coverImageAltText: string | null | undefined,
    coverImageCredit: string | null | undefined,
  ): ArticleMediaState {
    const url = coverImageUrl ?? null;
    const publicId = coverImagePublicId ?? null;

    if (!url && !publicId) {
      // Metadata should not remain populated when there is no image.
      if (coverImageAltText || coverImageCredit) {
        throw new AppError(
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          "Article cover-image metadata exists without a cover image",
        );
      }

      return {
        coverImage: null,
      };
    }

    // Both identifiers are required for an uploaded cover image.
    if (!url || !publicId) {
      throw new AppError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "Article cover image is inconsistent: URL and publicId are required",
      );
    }

    const coverImage: ArticleCoverImage = {
      url,
      publicId,
      altText: coverImageAltText,
      credit: coverImageCredit,
    };

    this.assertValidCoverImage(coverImage);

    return {
      coverImage,
    };
  }

  /**
   * Convert the application representation into database fields.
   *
   * Passing null removes the cover-image information from the
   * Article record. The command service is responsible for queuing
   * the old Cloudinary asset for deletion after the transaction commits.
   */
  public toDatabase(state: ArticleMediaState): ArticleMediaDbState {
    if (!state.coverImage) {
      return {
        coverImageUrl: null,
        coverImagePublicId: null,
        coverImageAltText: null,
        coverImageCredit: null,
      };
    }

    this.assertValidCoverImage(state.coverImage);

    return {
      coverImageUrl: state.coverImage.url,
      coverImagePublicId: state.coverImage.publicId,
      coverImageAltText: state.coverImage.altText ?? null,
      coverImageCredit: state.coverImage.credit ?? null,
    };
  }

  /**
   * Create a cover-image object from a successful upload result.
   *
   * The controller should obtain URL and publicId from the
   * authenticated Cloudinary upload middleware.
   */
  public createCoverImage(
    url: string,
    publicId: string,
    altText?: string | null,
    credit?: string | null,
  ): ArticleCoverImage {
    const coverImage: ArticleCoverImage = {
      url,
      publicId,
      altText,
      credit,
    };

    this.assertValidCoverImage(coverImage);

    return coverImage;
  }

  /**
   * Compare the previous and next cover-image states.
   *
   * Metadata changes can require a database update without requiring
   * Cloudinary deletion. The assetChanged flag distinguishes these cases.
   */
  public diff(
    previous: ArticleCoverImage | null,
    next: ArticleCoverImage | null,
  ): ArticleMediaDiff {
    const changed = !this.areSameCoverImage(previous, next);

    const assetChanged =
      previous?.publicId !== next?.publicId &&
      (previous !== null || next !== null);

    return {
      oldCoverImage: previous,
      newCoverImage: next,
      changed,
      assetChanged,
    };
  }

  /**
   * Determine whether two cover-image representations are equivalent.
   *
   * This compares metadata as well as the asset identifier so that
   * changing alt text or attribution is not silently ignored.
   */
  public areSameCoverImage(
    first: ArticleCoverImage | null,
    second: ArticleCoverImage | null,
  ): boolean {
    if (!first && !second) {
      return true;
    }

    if (!first || !second) {
      return false;
    }

    return (
      first.publicId === second.publicId &&
      first.url === second.url &&
      (first.altText ?? null) === (second.altText ?? null) &&
      (first.credit ?? null) === (second.credit ?? null)
    );
  }

  /**
   * Return the Cloudinary public ID that should be removed after
   * the database successfully references the new cover-image state.
   *
   * Replacing an image with another image removes the old asset.
   * Removing the cover image also removes the old asset.
   * Updating only alt text or attribution does not delete the asset.
   */
  public getRemovedPublicIds(diff: ArticleMediaDiff): string[] {
    if (!diff.assetChanged || !diff.oldCoverImage?.publicId) {
      return [];
    }

    return [diff.oldCoverImage.publicId];
  }

  /**
   * Validate an uploaded cover-image object.
   */
  private assertValidCoverImage(coverImage: ArticleCoverImage): void {
    if (!coverImage.url?.trim()) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Article cover image URL is required",
      );
    }

    if (!coverImage.publicId?.trim()) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Article cover image publicId is required",
      );
    }

    let parsedUrl: URL;

    try {
      parsedUrl = new URL(coverImage.url);
    } catch {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Article cover image URL must be valid",
      );
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Article cover image URL must use HTTP or HTTPS",
      );
    }

    if (
      coverImage.publicId.startsWith("http://") ||
      coverImage.publicId.startsWith("https://")
    ) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Article cover image publicId must not be a URL",
      );
    }
  }
}

export const articleMediaService = new ArticleMediaService();
