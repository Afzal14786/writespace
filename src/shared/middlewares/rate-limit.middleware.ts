import { createHash } from "node:crypto";
import type { Request, RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";

import env from "@config/env";
import { client } from "@config/redis";
import { HTTP_STATUS } from "@shared/constants/http-codes";

interface RateLimiterConfig {
  prefix: string;
  windowMs: number;
  limit: number;
  message: string;
  skipSuccessfulRequests?: boolean;
}

/**
 * Extracts and normalizes the email from an already validated request body.
 */
const getNormalizedEmail = (req: Request): string | undefined => {
  const body: unknown = req.body;

  if (typeof body !== "object" || body === null || !("email" in body)) {
    return undefined;
  }

  const email = body.email;

  if (typeof email !== "string" || !email.trim()) {
    return undefined;
  }

  return email.trim().toLowerCase();
};

/**
 * Creates an IP-based Redis rate limiter.
 *
 * express-rate-limit uses the client IP by default, including
 * its built-in IPv6 subnet handling.
 */
const createRateLimiter = ({
  prefix,
  windowMs,
  limit,
  message,
  skipSuccessfulRequests = false,
}: RateLimiterConfig): RequestHandler => {
  let limiter: RequestHandler | undefined;

  return (req, res, next) => {
    if (!limiter) {
      limiter = rateLimit({
        windowMs,
        limit,
        standardHeaders: true,
        legacyHeaders: false,
        passOnStoreError: false,
        skipSuccessfulRequests,

        store: new RedisStore({
          sendCommand: (...args: string[]) => client.sendCommand(args),
          prefix: `rl:${prefix}:`,
        }),

        handler: (_req, res) => {
          res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
            success: false,
            message,
            data: null,
          });
        },
      });
    }

    return limiter(req, res, next);
  };
};

/**
 * Creates an independent email-based Redis rate limiter.
 *
 * Email values are normalized and hashed before being used as Redis keys.
 * Apply this middleware after request validation.
 *
 * Requests without a valid email are handled by the IP limiter and
 * request validation, so they do not enter this limiter.
 */
const createEmailRateLimiter = ({
  prefix,
  windowMs,
  limit,
  message,
  skipSuccessfulRequests = false,
}: RateLimiterConfig): RequestHandler => {
  let limiter: RequestHandler | undefined;

  return (req, res, next) => {
    const email = getNormalizedEmail(req);

    if (!email) {
      return next();
    }

    if (!limiter) {
      limiter = rateLimit({
        windowMs,
        limit,
        standardHeaders: true,
        legacyHeaders: false,
        passOnStoreError: false,
        skipSuccessfulRequests,

        keyGenerator: (request) => {
          const normalizedEmail = getNormalizedEmail(request);

          // The outer middleware checks this before invoking the limiter.
          if (!normalizedEmail) {
            return "email:missing";
          }

          const emailHash = createHash("sha256")
            .update(normalizedEmail)
            .digest("hex");

          return `email:${emailHash}`;
        },

        store: new RedisStore({
          sendCommand: (...args: string[]) => client.sendCommand(args),
          prefix: `rl:${prefix}:`,
        }),

        handler: (_req, res) => {
          res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
            success: false,
            message,
            data: null,
          });
        },
      });
    }

    return limiter(req, res, next);
  };
};

// ============================================================
// GENERAL API — IP BASED
// ============================================================

export const apiLimiter = createRateLimiter({
  prefix: "api",
  windowMs: env.API_RATE_LIMIT_WINDOW_MS,
  limit: env.API_RATE_LIMIT_MAX_REQUESTS,
  message: "Too many requests. Please try again later.",
});

// ============================================================
// LOGIN — IP + EMAIL
// ============================================================

// IP: 10 failed attempts per 15 minutes.
export const loginLimiter = createRateLimiter({
  prefix: "login",
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
  limit: env.LOGIN_RATE_LIMIT_MAX_REQUESTS,
  message: "Too many login attempts. Please try again later.",
  skipSuccessfulRequests: true,
});

// Email: 5 failed attempts per 15 minutes.
export const loginEmailLimiter = createEmailRateLimiter({
  prefix: "login-email",
  windowMs: env.LOGIN_EMAIL_RATE_LIMIT_WINDOW_MS,
  limit: env.LOGIN_EMAIL_RATE_LIMIT_MAX_REQUESTS,
  message: "Too many login attempts for this account. Please try again later.",
  skipSuccessfulRequests: true,
});

// ============================================================
// REGISTRATION — IP + EMAIL
// ============================================================

// IP: 10 registration requests per hour.
export const registerLimiter = createRateLimiter({
  prefix: "register",
  windowMs: env.REGISTER_RATE_LIMIT_WINDOW_MS,
  limit: env.REGISTER_RATE_LIMIT_MAX_REQUESTS,
  message: "Too many registration attempts. Please try again later.",
});

// Email: 3 registration requests per hour.
export const registerEmailLimiter = createEmailRateLimiter({
  prefix: "register-email",
  windowMs: env.REGISTER_EMAIL_RATE_LIMIT_WINDOW_MS,
  limit: env.REGISTER_EMAIL_RATE_LIMIT_MAX_REQUESTS,
  message:
    "Too many registration attempts for this email. Please try again later.",
});

// ============================================================
// EMAIL VERIFICATION — IP + EMAIL
// ============================================================

// IP: 10 failed attempts per 15 minutes.
export const emailVerificationLimiter = createRateLimiter({
  prefix: "email-verification",
  windowMs: env.EMAIL_VERIFICATION_RATE_LIMIT_WINDOW_MS,
  limit: env.EMAIL_VERIFICATION_RATE_LIMIT_MAX_REQUESTS,
  message: "Too many email verification attempts. Please try again later.",
  skipSuccessfulRequests: true,
});

// Email: 5 failed attempts per 10 minutes.
export const emailVerificationEmailLimiter = createEmailRateLimiter({
  prefix: "email-verification-email",
  windowMs: env.EMAIL_VERIFICATION_EMAIL_RATE_LIMIT_WINDOW_MS,
  limit: env.EMAIL_VERIFICATION_EMAIL_RATE_LIMIT_MAX_REQUESTS,
  message:
    "Too many verification attempts for this email. Please try again later.",
  skipSuccessfulRequests: true,
});

// ============================================================
// FORGOT PASSWORD — IP + EMAIL
// ============================================================

// IP: 5 requests per hour.
export const forgotPasswordLimiter = createRateLimiter({
  prefix: "forgot-password",
  windowMs: env.FORGOT_PASSWORD_RATE_LIMIT_WINDOW_MS,
  limit: env.FORGOT_PASSWORD_RATE_LIMIT_MAX_REQUESTS,
  message: "Too many password reset requests. Please try again later.",
});

// Email: 3 requests per hour.
export const forgotPasswordEmailLimiter = createEmailRateLimiter({
  prefix: "forgot-password-email",
  windowMs: env.FORGOT_PASSWORD_EMAIL_RATE_LIMIT_WINDOW_MS,
  limit: env.FORGOT_PASSWORD_EMAIL_RATE_LIMIT_MAX_REQUESTS,
  message:
    "Too many password reset requests for this email. Please try again later.",
});

// ============================================================
// RESET PASSWORD — IP BASED
// ============================================================

// IP: 10 failed attempts per 15 minutes.
export const resetPasswordLimiter = createRateLimiter({
  prefix: "reset-password",
  windowMs: env.RESET_PASSWORD_RATE_LIMIT_WINDOW_MS,
  limit: env.RESET_PASSWORD_RATE_LIMIT_MAX_REQUESTS,
  message: "Too many password reset attempts. Please try again later.",
  skipSuccessfulRequests: true,
});
