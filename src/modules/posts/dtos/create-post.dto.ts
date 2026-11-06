import { z } from "zod";

/**
 * Inline nodes supported inside a paragraph.
 *
 * - text: regular text
 * - link: visible link text and its destination
 * - mention: reference to a registered user
 */
const ContentTextNodeSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const ContentLinkNodeSchema = z.object({
  type: z.literal("link"),
  text: z.string(),
  url: z.string().url("Link must be a valid URL"),
});

const ContentMentionNodeSchema = z.object({
  type: z.literal("mention"),
  userId: z.string().uuid("Mention must reference a valid user ID"),
});

const ContentInlineNodeSchema = z.discriminatedUnion("type", [
  ContentTextNodeSchema,
  ContentLinkNodeSchema,
  ContentMentionNodeSchema,
]);

/**
 * Paragraph blocks contain an ordered list of inline nodes.
 */
const ContentParagraphBlockSchema = z.object({
  type: z.literal("paragraph"),
  children: z.array(ContentInlineNodeSchema),
});

/**
 * Code blocks preserve their language and source code together.
 */
const ContentCodeBlockSchema = z.object({
  type: z.literal("code"),
  language: z.string().trim().min(1, "Code language is required"),
  code: z.string(),
});

/**
 * Every block must be either a paragraph or a code block.
 */
const ContentBlockSchema = z.discriminatedUnion("type", [
  ContentParagraphBlockSchema,
  ContentCodeBlockSchema,
]);

/**
 * The canonical structured document format stored in posts.content_document.
 */
export const ContentDocumentSchema = z
  .object({
    version: z.literal(1),
    blocks: z.array(ContentBlockSchema),
  })
  .superRefine((document, ctx) => {
    /*
     * Count visible text and source code characters.
     *
     * For links, count the visible text, not the URL.
     * Mentions store only user IDs, so they contribute no characters here.
     */
    const characterCount = document.blocks.reduce((total, block) => {
      if (block.type === "code") {
        return total + block.code.length;
      }

      const paragraphLength = block.children.reduce((length, node) => {
        if (node.type === "mention") {
          return length;
        }

        return length + node.text.length;
      }, 0);

      return total + paragraphLength;
    }, 0);

    if (characterCount > 6000) {
      ctx.addIssue({
        code: "custom",
        path: ["blocks"],
        message: "Post content cannot exceed 6,000 characters",
      });
    }
  });

/**
 * Create a short Post.
 *
 * A Post deliberately has no title, slug, cover image, or HTML content.
 * Images are uploaded separately and stored in post_media.
 */
export const CreatePostSchema = z.object({
  body: z
    .object({
      contentDocument: ContentDocumentSchema.default({
        version: 1,
        blocks: [],
      }),

      tags: z
        .array(z.string().trim().min(1, "Tag cannot be empty"))
        .max(5, "Maximum 5 tags allowed")
        .default([]),

      status: z.enum(["draft", "scheduled", "published"]).default("draft"),

      scheduledAt: z.string().datetime({ offset: true }).optional(),
    })
    .superRefine((data, ctx) => {
      if (data.status === "scheduled" && !data.scheduledAt) {
        ctx.addIssue({
          code: "custom",
          path: ["scheduledAt"],
          message: "scheduledAt is required for a scheduled Post",
        });
      }

      if (data.status !== "scheduled" && data.scheduledAt !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["scheduledAt"],
          message: "scheduledAt can only be provided for scheduled Posts",
        });
      }
    }),
});

export type CreatePostInput = z.infer<typeof CreatePostSchema>["body"];
