import { Request, Response, NextFunction } from "express";
import { authService } from "./auth.service";
import { ApiResponse } from "../../shared/utils/api-response";
import { HTTP_STATUS } from "../../shared/constants/http-codes";
import { RegisterInput } from "./dtos/register.dto";
import { LoginInput } from "./dtos/login.dto";
import { VerifyOtpInput } from "./dtos/verify-otp.dto";
import {
  ForgotPasswordInput,
  ResetPasswordInput,
} from "./dtos/password-reset.dto";
import env from "../../config/env";

// Cookie Config (HttpOnly)
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === "production", // Only secure in prod
  sameSite: "strict" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 Days
};

type EmptyParams = Record<string, never>;

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
      const ip = req.ip || "Unknown IP";
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

      const refreshToken = cookies?.refreshToken || (typeof body?.refreshToken === 'string' ? body.refreshToken : undefined);

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
      // We read the cookie directly to destroy the session. 
      // We DO NOT rely on req.user, because the access token might be expired.
      const cookies = req.cookies as Record<string, string> | undefined;
      const refreshToken = cookies?.refreshToken;

      if (refreshToken) {
         // Pass just the token to the service to destroy it
        await authService.logout(refreshToken);
      }

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
      const result = await authService.resetPassword(token, password);
      new ApiResponse(res, HTTP_STATUS.OK, result.message, null).send();
    } catch (error) {
      next(error);
    }
  }

  // 6. Google Callback
  public async googleCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const driverUser = req.user;
      if (!driverUser) {
        res.redirect(`${env.CLIENT_URL}/auth/failed`);
        return;
      }

      const profile = {
        provider: "google" as const,
        providerId: driverUser.id,
        email: driverUser.emails?.[0]?.value || "",
        displayName: driverUser.displayName || "Unknown User",
        picture: driverUser.photos?.[0]?.value,
      };

      const { accessToken, refreshToken } =
        await authService.googleAuth(profile);

      // Secure way to pass tokens to frontend:
      // 1. Set Refresh Cookie
      res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);

      // 2. Redirect with Access Token (or a temporary code)
      // Ideally avoid tokens in URL, but for simple OAuth it's common.
      // Better: Redirect to a frontend page that calls /refresh to get the token.
      res.redirect(`${env.CLIENT_URL}/auth/success?token=${accessToken}`);
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

      const profile = {
        provider: "github" as const,
        providerId: driverUser.id,
        email: driverUser.emails?.[0]?.value || "", 
        displayName: driverUser.displayName || driverUser.username || "GitHub User", 
        picture: driverUser.photos?.[0]?.value,
      };

      const { accessToken, refreshToken } = await authService.githubAuth(profile);

      res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);
      res.redirect(`${env.CLIENT_URL}/auth/success?token=${accessToken}`);
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
