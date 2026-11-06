import { Request, Response, NextFunction } from "express";
import { authService } from "./auth.service";
import { ApiResponse } from "@shared/utils/api-response";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import { RegisterInput } from "./dtos/register.dto";
import { LoginInput } from "./dtos/login.dto";
import { VerifyOtpInput } from "./dtos/verify-otp.dto";
import {
  ForgotPasswordInput,
  ResetPasswordInput,
} from "./dtos/password-reset.dto";
import env from "@config/env";

// Cookie Config (HttpOnly)
const isProd = process.env.NODE_ENV === "production";

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? ("none" as const) : ("lax" as const),
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days, matching JWT_REFRESH_EXPIRE
};

type EmptyParams = Record<string, never>;

/**
 * Returns a verified provider email.
 * Prefer the primary address when multiple verified addresses exist.
 */
function getVerifiedOAuthEmail(emails: unknown): string | undefined {
  if (!Array.isArray(emails)) {
    return undefined;
  }

  const verifiedEmails: Array<{
    value: string;
    primary: boolean;
  }> = [];

  for (const item of emails) {
    if (typeof item !== "object" || item === null) {
      continue;
    }

    const candidate = item as Record<string, unknown>;

    if (candidate.verified !== true || typeof candidate.value !== "string") {
      continue;
    }

    const value = candidate.value.trim();

    if (value.length > 0) {
      verifiedEmails.push({
        value,
        primary: candidate.primary === true,
      });
    }
  }

  return (
    verifiedEmails.find((email) => email.primary)?.value ??
    verifiedEmails[0]?.value
  );
}

export class AuthController {
  public async register(
    req: Request<EmptyParams, unknown, RegisterInput>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const result = await authService.initiateRegistration(req.body);
      new ApiResponse(res, HTTP_STATUS.OK, result.message, null).send();
    } catch (error) {
      next(error);
    }
  }

  // 2. Verify OTP & Create User
  public async verifyEmail(
    req: Request<EmptyParams, unknown, VerifyOtpInput>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { email, otp } = req.body;
      const { user, accessToken, refreshToken } =
        await authService.verifyRegistration(email, otp);

      res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);

      new ApiResponse(res, HTTP_STATUS.CREATED, "Registration successful", {
        user,
        accessToken,
      }).send();
    } catch (error) {
      next(error);
    }
  }

  // 3. Login
  public async login(
    req: Request<EmptyParams, unknown, LoginInput>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const ip = req.ip || req.socket.remoteAddress || "Unknown IP";
      const { user, accessToken, refreshToken } = await authService.login(
        req.body,
        ip,
      );

      res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);

      new ApiResponse(res, HTTP_STATUS.OK, "Login successful", {
        user,
        accessToken,
      }).send();
    } catch (error) {
      next(error);
    }
  }

  // 4. Refresh Token
  public async refreshToken(req: Request, res: Response, next: NextFunction) {
    try {
      // 100% Type Safe Cookie Parsing
      const cookies = req.cookies as Record<string, string> | undefined;
      const body = req.body as Record<string, unknown> | undefined;

      const refreshToken =
        cookies?.refreshToken ||
        (typeof body?.refreshToken === "string"
          ? body.refreshToken
          : undefined);

      if (!refreshToken) {
        new ApiResponse(
          res,
          HTTP_STATUS.UNAUTHORIZED,
          "Refresh Token required",
          null,
        ).send();
        return;
      }

      const tokens = await authService.refreshToken(refreshToken);
      res.cookie("refreshToken", tokens.refreshToken, REFRESH_COOKIE_OPTIONS);

      new ApiResponse(res, HTTP_STATUS.OK, "Token refreshed", {
        accessToken: tokens.accessToken,
      }).send();
    } catch (error) {
      next(error);
    }
  }

  // 5. Logout
  public async logout(req: Request, res: Response, next: NextFunction) {
    try {
      // Safely read a refresh token from an untrusted object.
      const readRefreshToken = (source: unknown): string | undefined => {
        if (
          typeof source !== "object" ||
          source === null ||
          !("refreshToken" in source)
        ) {
          return undefined;
        }

        const token = source.refreshToken;

        return typeof token === "string" && token.length > 0
          ? token
          : undefined;
      };

      // Prefer the HttpOnly cookie, with request-body fallback.
      const cookieRefreshToken = readRefreshToken(req.cookies as unknown);
      const bodyRefreshToken = readRefreshToken(req.body as unknown);

      const refreshToken = cookieRefreshToken || bodyRefreshToken;

      if (refreshToken) {
        await authService.logout(refreshToken);
      }

      // Clear the browser's refresh-token cookie.
      res.clearCookie("refreshToken");

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Logged out successfully",
        null,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  public async forgotPassword(
    req: Request<EmptyParams, unknown, ForgotPasswordInput>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const result = await authService.forgotPassword(req.body.email);
      new ApiResponse(res, HTTP_STATUS.OK, result.message, null).send();
    } catch (error) {
      next(error);
    }
  }

  public async resetPassword(
    req: Request<EmptyParams, unknown, ResetPasswordInput>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { token, password } = req.body;
      await authService.resetPassword(token, password);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Password reset successfully",
        null,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  public async googleCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const driverUser = req.user;

      if (!driverUser) {
        res.redirect(`${env.CLIENT_URL}/auth/failed`);
        return;
      }

      const email = getVerifiedOAuthEmail(driverUser.emails);

      if (!email) {
        res.redirect(
          `${env.CLIENT_URL}/auth/failed?reason=verified_email_required`,
        );
        return;
      }

      const profile = {
        provider: "google" as const,
        providerId: driverUser.id,
        email,
        displayName: driverUser.displayName || "Unknown User",
        picture: driverUser.photos?.[0]?.value,
      };

      const { refreshToken } = await authService.googleAuth(profile);

      res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);

      res.redirect(`${env.CLIENT_URL}/auth/success`);
    } catch (error) {
      next(error);
    }
  }

  public async githubCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const driverUser = req.user;

      if (!driverUser) {
        res.redirect(`${env.CLIENT_URL}/auth/failed`);
        return;
      }

      const email = getVerifiedOAuthEmail(driverUser.emails);

      if (!email) {
        res.redirect(
          `${env.CLIENT_URL}/auth/failed?reason=verified_email_required`,
        );
        return;
      }

      const profile = {
        provider: "github" as const,
        providerId: driverUser.id,
        email,
        displayName:
          driverUser.displayName || driverUser.username || "GitHub User",
        picture: driverUser.photos?.[0]?.value,
      };

      const { refreshToken } = await authService.githubAuth(profile);

      res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);

      res.redirect(`${env.CLIENT_URL}/auth/success`);
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
