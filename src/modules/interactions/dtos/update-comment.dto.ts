import { z } from "zod";

export const updateCommentSchema = z.object({
  body: z.object({
    content: z
      .string()
      .trim()
      .min(1, "Comment cannot be empty")
      .max(2500, "Comment is too long."),
  }),
});

export type UpdateCommentDto = z.infer<typeof updateCommentSchema>["body"];
