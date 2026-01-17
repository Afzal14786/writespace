import { z } from "zod";

export const CreatePostSchema = z.object({
  body: z.object({
    title: z.string().min(5, "Title must be at least 5 characters long"),
    subtitle: z.string().optional(),
    content: z.string().min(10, "Content must be at least 10 characters long"),
    tags: z.array(z.string()).optional(),

    // Media
    coverImage: z
      .object({
        url: z.string().url(),
        altText: z.string().optional(),
        credit: z.string().optional(),
        mobileUrl: z.string().url().optional(),
      })
      .optional(),
    audioUrl: z.string().url().optional(),
    attachments: z.array(z.string().url()).optional(),

    // Access
    isPublished: z.boolean().default(false),
    isPremium: z.boolean().default(false),

    // Taxonomy
    category: z.string().optional(), // ObjectId as string
    series: z
      .object({
        seriesId: z.string(),
        order: z.number(),
      })
      .optional(),

    coAuthors: z.array(z.string()).optional(),
  }),
});

export type CreatePostInput = z.infer<typeof CreatePostSchema>["body"];
