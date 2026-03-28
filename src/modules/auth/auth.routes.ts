import { Router, RequestHandler } from "express";
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
import { updatePasswordSchema } from "./dtos/update-password.dto";
import { authenticate } from "../../shared/middlewares/auth.middleware";
import { 
  loginLimiter, 
  registerLimiter, 
  emailActionLimiter 
} from "../../shared/middlewares/rate-limit.middleware";

const router = Router();

// Standard Auth
/**
 * @swagger
 * /api/v1/auth/register:
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
router.post("/register", registerLimiter, validate(registerSchema), authController.register);

/**
 * @swagger
 * /api/v1/auth/verify-email:
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
router.post("/verify-email", emailActionLimiter, validate(verifyOtpSchema), authController.verifyEmail);

/**
 * @swagger
 * /api/v1/auth/login:
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
router.post("/login", loginLimiter, validate(loginSchema), authController.login);

router.post("/forgot-password", emailActionLimiter, authenticate, validate(forgotPasswordSchema), authController.forgotPassword);
router.post("/reset-password", emailActionLimiter, validate(resetPasswordSchema), authController.resetPassword);

/**
 * @swagger
 * /api/v1/auth/update-password:
 * put:
 * summary: Update user password
 * tags: [Auth]
 * security:
 * - bearerAuth: []
 * requestBody:
 * required: true
 * content:
 * application/json:
 * schema:
 * type: object
 * properties:
 * currentPassword:
 * type: string
 * newPassword:
 * type: string
 * responses:
 * 200:
 * description: Password updated successfully
 */

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
