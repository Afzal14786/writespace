import { z } from "zod";

export const verifyOtpSchema = z.object({
  body: z.object({
    email: z.string().email("Invalid email address"),
    otp: z.string().regex(/^\d{6}$/, "OTP must contain exactly 6 digits"),
  }),
});

export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>["body"];
