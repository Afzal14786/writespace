import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    // PostgreSQL

    DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
    DB_POOL_MIN: z.coerce.number().int().min(0).default(2),
    DB_POOL_MAX: z.coerce.number().int().min(1).default(10),
    DB_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),

    // Redis

    REDIS_URL: z
      .string()
      .url("REDIS_URL must be a valid URL")
      .default("redis://localhost:6379"),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),

    // BullMQ / Workers

    EMAIL_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),

    MEDIA_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
    EMAIL_QUEUE_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    MEDIA_QUEUE_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    QUEUE_BACKOFF_DELAY_MS: z.coerce.number().int().positive().default(1000),

    // Legacy notification queue.
    NOTIFICATION_WORKER_CONCURRENCY: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10),

    NOTIFICATION_QUEUE_ATTEMPTS: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .default(2),

    // Durable notification delivery reconciliation.

    // Frequency at which the reconciliation worker inspects deliveries.
    NOTIFICATION_RECONCILIATION_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15000),

    // Keep reconciliation batches bounded to avoid long-running database transactions.
    NOTIFICATION_RECONCILIATION_BATCH_SIZE: z.coerce
      .number()
      .int()
      .min(1)
      .max(250)
      .default(25),

    // Lease prevents multiple reconciliation workers from repairing
    // the same delivery concurrently.
    NOTIFICATION_RECONCILIATION_LEASE_DURATION_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(30000),

    // Stop automatic queue recovery after a bounded number of repairs.
    NOTIFICATION_RECONCILIATION_MAX_ATTEMPTS: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5),

    // Give the normal delivery worker time to process newly published jobs.
    NOTIFICATION_RECONCILIATION_INITIAL_GRACE_PERIOD_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(30000),

    // Minimum delay before inspecting a delivery again after reconciliation.
    NOTIFICATION_RECONCILIATION_RETRY_DELAY_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(60000),

    // Durable notification event pipeline.
    // Disabled by default until the outbox/processed-events migration has
    // been reviewed and applied to the target PostgreSQL database.
    OUTBOX_PROCESSING_ENABLED: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .prefault("false"),

    // How frequently the dispatcher looks for pending outbox events.
    OUTBOX_DISPATCHER_POLL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(1000),

    // Keep batches bounded so a dispatcher does not claim more rows than
    // it can reasonably hand off before its lease expires.
    OUTBOX_DISPATCHER_BATCH_SIZE: z.coerce
      .number()
      .int()
      .min(1)
      .max(250)
      .default(25),

    // If a dispatcher crashes, another instance can reclaim the event
    // after this lease expires.
    OUTBOX_DISPATCHER_LEASE_DURATION_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(60000),

    // Lease duration for an individual notification channel delivery.
    // The delivery worker renews this lease while its handler is running.
    NOTIFICATION_DELIVERY_LEASE_DURATION_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(60000),

    // Maximum number of failed queue handoff attempts before an outbox
    // event moves to FAILED for inspection/recovery.
    OUTBOX_DISPATCHER_MAX_ATTEMPTS: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10),

    // Exponential retry delay for the outbox-to-BullMQ handoff.
    OUTBOX_DISPATCHER_BACKOFF_BASE_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(1000),

    OUTBOX_DISPATCHER_BACKOFF_MAX_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(60000),

    // HTTP / Application

    CLIENT_URL: z
      .string()
      .url("CLIENT_URL must be a valid URL")
      .default("http://localhost:5173"),

    SERVER_URL: z
      .string()
      .url("SERVER_URL must be a valid URL")
      .default("http://localhost:8000/api/v1"),

    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),

    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),

    // Rate limiting

    // General API: 300 requests per IP per 15 minutes.
    API_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(900000),
    API_RATE_LIMIT_MAX_REQUESTS: z.coerce
      .number()
      .int()
      .positive()
      .default(300),

    // Login: IP-based limit.
    LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(900000),
    LOGIN_RATE_LIMIT_MAX_REQUESTS: z.coerce
      .number()
      .int()
      .positive()
      .default(10),

    // Login: email-based failed-attempt limit.
    LOGIN_EMAIL_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(900000),
    LOGIN_EMAIL_RATE_LIMIT_MAX_REQUESTS: z.coerce
      .number()
      .int()
      .positive()
      .default(5),

    // Registration: IP-based limit.
    REGISTER_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(3600000),
    REGISTER_RATE_LIMIT_MAX_REQUESTS: z.coerce
      .number()
      .int()
      .positive()
      .default(10),

    // Registration: email-based limit.
    REGISTER_EMAIL_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(3600000),
    REGISTER_EMAIL_RATE_LIMIT_MAX_REQUESTS: z.coerce
      .number()
      .int()
      .positive()
      .default(3),

    // Email verification: IP-based failed-attempt limit.
    EMAIL_VERIFICATION_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(900000),
    EMAIL_VERIFICATION_RATE_LIMIT_MAX_REQUESTS: z.coerce
      .number()
      .int()
      .positive()
      .default(10),

    // Email verification: email-based failed-attempt limit.
    EMAIL_VERIFICATION_EMAIL_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(600000),
    EMAIL_VERIFICATION_EMAIL_RATE_LIMIT_MAX_REQUESTS: z.coerce
      .number()
      .int()
      .positive()
      .default(5),

    // Forgot password: IP-based limit.
    FORGOT_PASSWORD_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(3600000),
    FORGOT_PASSWORD_RATE_LIMIT_MAX_REQUESTS: z.coerce
      .number()
      .int()
      .positive()
      .default(5),

    // Forgot password: email-based limit.
    FORGOT_PASSWORD_EMAIL_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(3600000),
    FORGOT_PASSWORD_EMAIL_RATE_LIMIT_MAX_REQUESTS: z.coerce
      .number()
      .int()
      .positive()
      .default(3),

    // Reset password: IP-based failed-attempt limit.
    RESET_PASSWORD_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(900000),
    RESET_PASSWORD_RATE_LIMIT_MAX_REQUESTS: z.coerce
      .number()
      .int()
      .positive()
      .default(10),

    // Authentication

    JWT_ACCESS_SECRET: z.string().min(1, "JWT_ACCESS_SECRET is required"),
    JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET is required"),
    JWT_ACCESS_EXPIRE: z.string().default("15m"),

    // Cloudinary

    CLOUDINARY_CLOUD_NAME: z
      .string()
      .min(1, "CLOUDINARY_CLOUD_NAME is required"),
    CLOUDINARY_API_KEY: z.string().min(1, "CLOUDINARY_API_KEY is required"),
    CLOUDINARY_API_SECRET: z
      .string()
      .min(1, "CLOUDINARY_API_SECRET is required"),

    // Upload limits

    MAX_FILE_SIZE_MB: z.coerce.number().positive().default(5),
    MAX_FILES_PER_UPLOAD: z.coerce.number().int().positive().default(12),

    // SMTP

    SMTP_HOST: z.string().min(1).default("smtp.gmail.com"),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_USER: z.string().min(1, "SMTP_USER is required"),
    SMTP_PASS: z.string().min(1, "SMTP_PASS is required"),

    SMTP_CONNECTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(30000),

    SMTP_GREETING_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),

    SMTP_SOCKET_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),

    // OAuth

    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),

    // AI

    AI_ENABLED: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .prefault("false"),

    AI_PROVIDER: z.enum(["gemini", "mock"]).default("gemini"),
    AI_MODEL: z.string().min(1, "AI model name is required"),
    GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(1000),
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
    AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    AI_MAX_INPUT_CHARS: z.coerce.number().int().positive().default(12000),
  })
  .refine((data) => data.DB_POOL_MIN <= data.DB_POOL_MAX, {
    message: "DB_POOL_MIN cannot be greater than DB_POOL_MAX",
    path: ["DB_POOL_MIN"],
  })
  .refine(
    (data) =>
      data.OUTBOX_DISPATCHER_BACKOFF_MAX_MS >=
      data.OUTBOX_DISPATCHER_BACKOFF_BASE_MS,
    {
      message:
        "OUTBOX_DISPATCHER_BACKOFF_MAX_MS cannot be smaller than OUTBOX_DISPATCHER_BACKOFF_BASE_MS",
      path: ["OUTBOX_DISPATCHER_BACKOFF_MAX_MS"],
    },
  );

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error("Invalid environment variables:", _env.error.format());
  process.exit(1);
}

export const env = _env.data;
export default env;
