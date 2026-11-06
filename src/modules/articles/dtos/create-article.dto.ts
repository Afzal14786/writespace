import { z } from "zod";

/**
 * ---------------------------------------------------------
 * Content document validation
 * ---------------------------------------------------------
 *
 * Articles and Posts use the same ContentDocument structure.
 *
 * We define the Article validation schema independently here
 * so that the Post-specific 6,000-character limit is not applied
 * to long-form Articles.
 */

/**
 * Plain text inside a paragraph.
 */
const ContentTextNodeSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

/**
 * Hyperlinks inside a paragraph.
 *
 * Only HTTP and HTTPS URLs are accepted. This prevents unsafe
 * schemes such as javascript: from being stored as content links.
 */
const ContentLinkNodeSchema = z.object({
  type: z.literal("link"),
  text: z.string(),
  url: z
    .string()
    .url("Link must contain a valid URL")
    .refine((value) => {
      try {
        const protocol = new URL(value).protocol;

        return protocol === "http:" || protocol === "https:";
      } catch {
        return false;
      }
    }, "Only HTTP and HTTPS links are allowed"),
});

/**
 * Mentions reference registered users by their UUID.
 *
 * The command service will additionally verify that each
 * referenced user exists in the database.
 */
const ContentMentionNodeSchema = z.object({
  type: z.literal("mention"),
  userId: z.string().uuid("Mentioned user ID must be a valid UUID"),
});

/**
 * Supported inline elements inside paragraphs.
 */
const ContentInlineNodeSchema = z.discriminatedUnion("type", [
  ContentTextNodeSchema,
  ContentLinkNodeSchema,
  ContentMentionNodeSchema,
]);

/**
 * Paragraph block containing text, links and mentions.
 */
const ContentParagraphBlockSchema = z.object({
  type: z.literal("paragraph"),
  children: z.array(ContentInlineNodeSchema),
});

/**
 * Code block containing a programming language and source code.
 */
const ContentCodeBlockSchema = z.object({
  type: z.literal("code"),
  language: z
    .string()
    .trim()
    .min(1, "Code block language is required")
    .max(50, "Code block language cannot exceed 50 characters"),
  code: z.string(),
});

/**
 * All supported Article block types.
 */
const ContentBlockSchema = z.discriminatedUnion("type", [
  ContentParagraphBlockSchema,
  ContentCodeBlockSchema,
]);

/**
 * Complete structured Article document.
 *
 * Empty documents are permitted for drafts.
 * Publication requirements will be enforced by the command service.
 *
 * No Post-specific character limit is applied here.
 */
export const ArticleContentDocumentSchema = z.object({
  version: z.literal(1),
  blocks: z.array(ContentBlockSchema),
});

/**
 * ---------------------------------------------------------
 * Article creation validation
 * ---------------------------------------------------------
 */

export const CreateArticleSchema = z.object({
  body: z
    .object({
      /**
       * Article title.
       *
       * Used for Article detail pages, search results and metadata.
       */
      title: z
        .string()
        .trim()
        .min(5, "Article title must be at least 5 characters long")
        .max(200, "Article title cannot exceed 200 characters"),

      /**
       * Optional custom URL slug.
       *
       * If omitted, the command service generates a slug
       * from the Article title.
       *
       * Slugs must be lowercase and URL-friendly.
       */
      slug: z
        .string()
        .trim()
        .min(1, "Slug cannot be empty")
        .max(250, "Slug cannot exceed 250 characters")
        .regex(
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
          "Slug can contain lowercase letters, numbers and hyphens only",
        )
        .optional(),

      /**
       * Optional subtitle displayed below the Article title.
       */
      subtitle: z
        .string()
        .trim()
        .max(300, "Subtitle cannot exceed 300 characters")
        .nullable()
        .optional(),

      /**
       * Structured Article content.
       *
       * Defaults to an empty document so that authors can
       * create an Article draft before writing its content.
       */
      contentDocument: ArticleContentDocumentSchema.default({
        version: 1,
        blocks: [],
      }),

      /**
       * Optional manually supplied excerpt.
       *
       * If omitted, the command service can generate one
       * from the Article content.
       */
      excerpt: z
        .string()
        .trim()
        .max(300, "Excerpt cannot exceed 300 characters")
        .nullable()
        .optional(),

      /**
       * Article tags.
       *
       * Maximum five tags per Article.
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
        .default([]),

      /**
       * Initial lifecycle state.
       *
       * Draft is the default so that Articles are not accidentally
       * published when the client omits the status field.
       */
      status: z.enum(["draft", "scheduled", "published"]).default("draft"),

      /**
       * Required when the initial status is scheduled.
       *
       * The command service will additionally validate that
       * the requested publication time is in the future.
       */
      scheduledAt: z.string().datetime({ offset: true }).optional(),

      /**
       * Cover image accessibility text.
       *
       * The actual image URL and Cloudinary public ID come
       * from the authenticated upload process, not the client body.
       */
      coverImageAltText: z
        .string()
        .trim()
        .max(300, "Cover image alt text cannot exceed 300 characters")
        .nullable()
        .optional(),

      /**
       * Optional image attribution.
       */
      coverImageCredit: z
        .string()
        .trim()
        .max(300, "Cover image credit cannot exceed 300 characters")
        .nullable()
        .optional(),
    })
    .superRefine((data, ctx) => {
      /**
       * A scheduled Article must have a publication time.
       */
      if (data.status === "scheduled" && !data.scheduledAt) {
        ctx.addIssue({
          code: "custom",
          path: ["scheduledAt"],
          message: "scheduledAt is required when scheduling an Article",
        });
      }

      /**
       * Non-scheduled Articles must not receive a schedule time.
       */
      if (data.status !== "scheduled" && data.scheduledAt !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["scheduledAt"],
          message: "scheduledAt can only be provided when status is scheduled",
        });
      }
    }),
});

export type CreateArticleInput = z.infer<typeof CreateArticleSchema>["body"];
