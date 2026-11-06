import { z } from "zod";

export const updatePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters long")
      .regex(
        /[A-Z]/,
        "New password must contain at least one uppercase letter",
      )
      .regex(
        /[a-z]/,
        "New password must contain at least one lowercase letter",
      )
      .regex(/[0-9]/, "New password must contain at least one number"),
  }),
});

export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>["body"];
