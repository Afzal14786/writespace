import { Router, RequestHandler } from "express";
import passport from "passport";
import { authController } from "./auth.controller";
import { validate } from "@shared/middlewares/validate.middleware";
import { registerSchema } from "./dtos/register.dto";
import { loginSchema } from "./dtos/login.dto";
import { verifyOtpSchema } from "./dtos/verify-otp.dto";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
} from "./dtos/password-reset.dto";
import { updatePasswordSchema } from "./dtos/update-password.dto";
import { authenticate } from "@shared/middlewares/auth.middleware";
import { 
  loginLimiter, 
  registerLimiter, 
  emailActionLimiter 
} from "@shared/middlewares/rate-limit.middleware";

const router = Router();

// Standard Auth

router.post("/register", registerLimiter, validate(registerSchema), authController.register);

router.post("/verify-email", emailActionLimiter, validate(verifyOtpSchema), authController.verifyEmail);

router.post("/login", loginLimiter, validate(loginSchema), authController.login);

router.post("/forgot-password", emailActionLimiter, authenticate, validate(forgotPasswordSchema), authController.forgotPassword);
router.post("/reset-password", emailActionLimiter, validate(resetPasswordSchema), authController.resetPassword);

router.put(
  "/update-password",
  authenticate,
  validate(updatePasswordSchema),
  authController.updatePassword
);

router.post("/refresh-token", authController.refreshToken);
router.post("/logout", authController.logout);

// Google Auth
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] }) as unknown as RequestHandler,
);
router.get(
  "/google/callback",
  passport.authenticate("google", { session: false }) as unknown as RequestHandler,
  authController.googleCallback,
);

// GitHub Auth (If configured)
router.get(
  "/github",
  passport.authenticate("github", { scope: ["user:email"] }) as RequestHandler,
);

router.get(
  "/github/callback",
  passport.authenticate("github", { session: false }) as RequestHandler,
  authController.githubCallback,
);

export const authRoutes = router;
