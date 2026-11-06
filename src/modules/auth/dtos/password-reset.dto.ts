import { z } from "zod";

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email("Invalid email address"),
  }),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>["body"];

export const resetPasswordSchema = z.object({
  body: z.object({
    // Reset tokens are generated using generateOTP(32),
    // so they must contain exactly 32 numeric characters.
    token: z.string().regex(/^\d{32}$/, "Invalid or expired reset token"),

    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[a-z]/, "Password must contain at least one lowercase letter")
      .regex(/[0-9]/, "Password must contain at least one number"),
  }),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>["body"];
