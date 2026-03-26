import { z } from "zod";

export const CreatePostSchema = z.object({
  body: z.object({
    title: z.string().min(5, "Title must be at least 5 characters long"),
    subtitle: z.string().optional(),
    content: z.string().optional().default(""),
    tags: z.array(z.string()).optional(),

    codeSnippets: z.array(
      z.object({
        language: z.string(),
        code: z.string(),
      })
    ).optional(),

    // Access
    isPublished: z.boolean().default(false),
    isPremium: z.boolean().default(false),
  }),
});

export type CreatePostInput = z.infer<typeof CreatePostSchema>["body"];
