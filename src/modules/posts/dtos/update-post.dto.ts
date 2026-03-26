import { z } from "zod";

export const updatePostSchema = z.object({
  body: z.object({
    title: z.string().min(3, "Title must be at least 3 characters").max(100, "Title cannot exceed 100 characters").optional(),
    content: z.string().min(10, "Content must be at least 10 characters").optional(),
    subtitle: z.string().optional(),
    excerpt: z.string().max(300, "Excerpt cannot exceed 300 characters").optional().nullable(),
    
    // Parsed from FormData
    tags: z.array(z.string()).max(5, "Maximum 5 tags allowed").optional(),
    codeSnippets: z.array(
      z.object({
        language: z.string(),
        code: z.string(),
      })
    ).optional().nullable(),

    // Sent from frontend during edits (can be a single string or array of strings)
    existingMedia: z.union([
      z.string().url(), 
      z.array(z.string().url())
    ]).optional(),

    // Access & Status
    status: z.enum(["draft", "published", "archived"]).optional(),
    isPublished: z.union([z.boolean(), z.enum(["true", "false"])]).optional(),
  }),
});

export type UpdatePostDto = z.infer<typeof updatePostSchema>["body"];