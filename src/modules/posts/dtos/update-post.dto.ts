import { z } from "zod";

import { ContentDocumentSchema } from "./create-post.dto";

export const updatePostSchema = z.object({
  body: z
    .object({
      /**
       * Omitted means the existing content document remains unchanged.
       * The shared schema enforces the document structure and character limit.
       */
      contentDocument: ContentDocumentSchema.optional(),

      /**
       * Omitted means existing tags remain unchanged.
       */
      tags: z
        .array(z.string().trim().min(1, "Tag cannot be empty"))
        .max(5, "Maximum 5 tags allowed")
        .optional(),

      /**
       * Omitted means the existing lifecycle status remains unchanged.
       */
      status: z.enum(["draft", "scheduled", "published"]).optional(),

      /**
       * A scheduled Post can have its publication time changed.
       *
       * `null` is accepted so the schedule can be explicitly cleared
       * when transitioning the Post back to draft or publishing it.
       */
      scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),

      /**
       * Database IDs of existing media attachments to remove.
       *
       * These are post_media.id values, not Cloudinary publicIds.
       * Newly uploaded images arrive through the multipart "media" field.
       */
      removeMediaIds: z
        .array(z.string().uuid("Each media attachment ID must be a valid UUID"))
        .max(5, "Maximum 5 media attachments can be removed at once")
        .optional(),
    })
    .superRefine((data, ctx) => {
      /**
       * A schedule time must not be supplied when explicitly changing
       * the Post to draft or published.
       *
       * When status is omitted, the command service checks the existing
       * status and resolves the resulting lifecycle state.
       */
      if (
        data.status !== undefined &&
        data.status !== "scheduled" &&
        data.scheduledAt != null
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["scheduledAt"],
          message:
            "scheduledAt can only be provided when the resulting status is scheduled",
        });
      }
    }),
});

export type UpdatePostDto = z.infer<typeof updatePostSchema>["body"];
