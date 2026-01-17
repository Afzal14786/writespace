import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.string().default("3000"),
  MONGO_URI: z.string().min(1, "MONGO_URI is required"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  REDIS_PASSWORD: z.string().optional(),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  CLIENT_URL: z.string().default("http://localhost:3000"),

  // AWS S3 Configuration
  AWS_REGION: z.string().min(1, "AWS_REGION is required"),
  AWS_ACCESS_KEY_ID: z.string().min(1, "AWS_ACCESS_KEY_ID is required"),
  AWS_SECRET_ACCESS_KEY: z.string().min(1, "AWS_SECRET_ACCESS_KEY is required"),
  AWS_BUCKET_NAME: z.string().min(1, "AWS_BUCKET_NAME is required"),

  // SMTP Configuration (Email)
  SMTP_HOST: z.string().min(1, "SMTP_HOST is required"),
  SMTP_PORT: z.coerce.number().default(465),
  SMTP_USER: z.string().min(1, "SMTP_USER is required"),
  SMTP_PASS: z.string().min(1, "SMTP_PASS is required"),
  EMAIL_FROM: z.string().email().default("no-reply@blogify.com"),

  // OAuth Configuration
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error("❌ Invalid environment variables:", _env.error.format());
  process.exit(1);
}

export const env = _env.data;
export default env;
