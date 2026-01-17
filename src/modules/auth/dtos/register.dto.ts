import { z } from "zod";

export const registerSchema = z.object({
  body: z.object({
    fullname: z.string().min(3, "Fullname must be at least 3 characters"),
    username: z.string().min(3, "Username must be at least 3 characters"),
    email: z.string().email("Invalid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[a-z]/, "Password must contain at least one lowercase letter")
      .regex(/[0-9]/, "Password must contain at least one number"),
  }),
});

export type RegisterInput = z.infer<typeof registerSchema>["body"];
