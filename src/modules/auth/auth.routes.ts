import { Router } from "express";
import passport from "passport";
import { authController } from "./auth.controller";
import { validate } from "../../shared/middlewares/validate.middleware";
import { registerSchema } from "./dtos/register.dto";
import { loginSchema } from "./dtos/login.dto";
import { verifyOtpSchema } from "./dtos/verify-otp.dto";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
} from "./dtos/password-reset.dto";
import { authenticate } from "../../shared/middlewares/auth.middleware";
import { authLimiter } from "../../shared/middlewares/rate-limit.middleware";

const router = Router();

// Standard Auth
/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterInput'
 *     responses:
 *       200:
 *         description: OTP sent
 */
router.post(
  "/register",
  authLimiter,
  validate(registerSchema),
  authController.register,
);

/**
 * @swagger
 * /api/auth/verify-email:
 *   post:
 *     summary: Verify OTP and create account
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               otp:
 *                 type: string
 *     responses:
 *       201:
 *         description: User registered successfully
 */
router.post(
  "/verify-email",
  authLimiter,
  validate(verifyOtpSchema),
  authController.verifyEmail,
);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Log in
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginInput'
 *     responses:
 *       200:
 *         description: Login successful
 */
router.post("/login", authLimiter, validate(loginSchema), authController.login);

router.post(
  "/forgot-password",
  authLimiter,
  validate(forgotPasswordSchema),
  authController.forgotPassword,
);
router.post(
  "/reset-password",
  authLimiter,
  validate(resetPasswordSchema),
  authController.resetPassword,
);
router.post("/refresh", authController.refreshToken);
router.post("/logout", authenticate, authController.logout);

// Google Auth
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] }),
);
router.get(
  "/google/callback",
  passport.authenticate("google", { session: false }),
  authController.googleCallback,
);

// GitHub Auth (If configured)
// router.get('/github', passport.authenticate('github', { scope: ['user:email'] }));
// router.get('/github/callback', ...);

export const authRoutes = router;
