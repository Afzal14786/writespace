import { z } from "zod";

import { ArticleContentDocumentSchema } from "./create-article.dto";

/**
 * Validate a URL-friendly Article slug.
 *
 * Slugs use lowercase letters, numbers, and hyphens.
 * The command service is responsible for checking uniqueness.
 */
const ArticleSlugSchema = z
  .string()
  .trim()
  .min(1, "Slug cannot be empty")
  .max(250, "Slug cannot exceed 250 characters")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug can contain lowercase letters, numbers and hyphens only",
  );

/**
 * Validate a partial Article update.
 *
 * Omitted fields remain unchanged.
 * Explicit null values are supported for nullable fields.
 */
export const UpdateArticleSchema = z.object({
  body: z
    .object({
      /**
       * Updated Article title.
       *
       * Changing the title does not automatically change the slug.
       */
      title: z
        .string()
        .trim()
        .min(5, "Article title must be at least 5 characters long")
        .max(200, "Article title cannot exceed 200 characters")
        .optional(),

      /**
       * Explicitly supplied slug.
       *
       * If omitted, the existing slug remains unchanged.
       * Uniqueness is checked by the command service.
       */
      slug: ArticleSlugSchema.optional(),

      /**
       * Updated subtitle.
       *
       * `null` explicitly removes the existing subtitle.
       */
      subtitle: z
        .string()
        .trim()
        .max(300, "Subtitle cannot exceed 300 characters")
        .nullable()
        .optional(),

      /**
       * Updated structured Article document.
       *
       * The same document structure is used during creation.
       */
      contentDocument: ArticleContentDocumentSchema.optional(),

      /**
       * Updated manually supplied excerpt.
       *
       * `null` allows the existing excerpt to be cleared.
       * The command service can regenerate an excerpt when appropriate.
       */
      excerpt: z
        .string()
        .trim()
        .max(300, "Excerpt cannot exceed 300 characters")
        .nullable()
        .optional(),

      /**
       * Updated Article tags.
       *
       * Supplying an empty array removes all existing tags.
       */
      tags: z
        .array(
          z
            .string()
            .trim()
            .min(1, "Tag cannot be empty")
            .max(50, "Tag cannot exceed 50 characters"),
        )
        .max(5, "Maximum 5 tags allowed")
        .optional(),

      /**
       * New lifecycle status.
       *
       * Allowed transitions are enforced by the command service.
       */
      status: z.enum(["draft", "scheduled", "published"]).optional(),

      /**
       * Change or clear the scheduled publication time.
       *
       * The command service validates the resulting lifecycle state
       * and ensures scheduled Articles have a future publication time.
       */
      scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),

      /**
       * Updated cover-image accessibility text.
       */
      coverImageAltText: z
        .string()
        .trim()
        .max(300, "Cover image alt text cannot exceed 300 characters")
        .nullable()
        .optional(),

      /**
       * Updated cover-image attribution.
       */
      coverImageCredit: z
        .string()
        .trim()
        .max(300, "Cover image credit cannot exceed 300 characters")
        .nullable()
        .optional(),

      /**
       * Explicitly remove the current cover image.
       *
       * The command service will delete the database reference and
       * enqueue the corresponding Cloudinary asset for cleanup.
       */
      removeCoverImage: z.boolean().optional(),
    })
    .superRefine((data, ctx) => {
      /**
       * A scheduled time must not be supplied when explicitly changing
       * an Article to draft or published.
       */
      if (
        data.status !== undefined &&
        data.status !== "scheduled" &&
        data.scheduledAt != null
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["scheduledAt"],
          message: "scheduledAt can only be provided when status is scheduled",
        });
      }

      /**
       * A cover image cannot be uploaded and removed in the same update.
       *
       * The command service/controller will also enforce this when
       * processing the uploaded cover-image file.
       */
      if (data.removeCoverImage === true) {
        // This is a body-level removal instruction.
        // The controller will reject it if a new cover file is uploaded.
      }
    }),
});

export type UpdateArticleInput = z.infer<typeof UpdateArticleSchema>["body"];
