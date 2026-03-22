import { Router } from "express";
import { userController } from "./user.controller";
import { authenticate, authorize } from "../../shared/middlewares/auth.middleware";
import { validate } from "../../shared/middlewares/validate.middleware";
import { UpdateProfileSchema } from "./dtos/update-profile.dto";

const router = Router();

/**
 * @route   GET /api/v1/users/check-username
 * @desc    Check if a username is available during registration
 * @access  Public
 */
router.get("/check-username", userController.checkUsername);

/**
 * @route   GET /api/v1/users/me
 * @desc    Get current authenticated user's session data
 * @access  Private
 */
router.get("/me", authenticate, userController.getMe);

/**
 * @route   GET /api/v1/users/profile/:username
 * @desc    Get public profile data by username
 * @access  Public
 */
router.get("/profile/:username", userController.getProfile);

/**
 * @route   PUT /api/v1/users/:id
 * @desc    Update profile fields (Fullname, Bio, Social links)
 * @access  Private (Owner/Admin)
 */
router.put(
  "/:id",
  authenticate,
  authorize("admin", "user"),
  validate(UpdateProfileSchema),
  userController.updateProfile,
);

/**
 * @route   DELETE /api/v1/users/:id
 * @desc    Suspend/Soft-delete account
 * @access  Private (Owner/Admin)
 */
router.delete(
  "/:id",
  authenticate,
  authorize("admin", "user"),
  userController.deleteUser,
);

export const userRoutes = router;