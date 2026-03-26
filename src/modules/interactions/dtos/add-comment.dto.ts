import { z } from "zod";

export const addCommentSchema = z.object({
  body: z.object({
    content: z
      .string()
      .trim()
      .min(1, "Comment cannot be empty")
      .max(2500, "Comment is too long."),
    parentCommentId: z.string().uuid("Invalid parent comment ID").optional().nullable(),
  }),
});

export type AddCommentDto = z.infer<typeof addCommentSchema>["body"];