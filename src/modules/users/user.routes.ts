import { Router, type RequestHandler } from "express";
import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import { UserController } from "./user.controller";
import { authenticate, authorize } from "@shared/middlewares/auth.middleware";
import { validate } from "@shared/middlewares/validate.middleware";
import { parseFormDataJson } from "@shared/middlewares/parse-form-data.middleware";
import { upload } from "@shared/middlewares/upload.middleware";
import { UpdateProfileSchema } from "./dtos/update-profile.dto";
import { updatePasswordSchema } from "./dtos/update-password.dto";

const router = Router();

/**
 * Allows profile updates only for the account owner or an administrator.
 *
 * This must execute before Multer/Cloudinary to avoid unauthorized uploads.
 */
const authorizeProfileOwnerOrAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user?.id) {
    return next(
      new AppError(HTTP_STATUS.UNAUTHORIZED, "Authentication required"),
    );
  }

  if (req.params.id !== req.user.id && req.user.role !== "admin") {
    return next(
      new AppError(
        HTTP_STATUS.FORBIDDEN,
        "You do not have permission to update this profile",
      ),
    );
  }

  next();
};

/**
 * @route   GET /api/v1/users/check-username
 * @desc    Check if a username is available during registration
 * @access  Public
 *
 * This endpoint remains public because it is used during registration.
 */
router.get("/check-username", UserController.checkUsername);

/**
 * @route   GET /api/v1/users/og/:username
 * @desc    Generate a profile Open Graph image
 * @access  Private
 */
router.get(
  "/og/:username",
  authenticate,
  UserController.getProfileDynamicOgImage,
);

/**
 * @route   GET /api/v1/users/search
 * @desc    Search users by username or fullname
 * @access  Private
 */
router.get("/search", authenticate, UserController.searchUsers);

/**
 * @route   GET /api/v1/users/me
 * @desc    Get current authenticated user's session data
 * @access  Private
 */
router.get("/me", authenticate, UserController.getMe);

/**
 * @route   PUT /api/v1/users/me/password
 * @desc    Change the authenticated user's password
 * @access  Private
 */
router.put(
  "/me/password",
  authenticate,
  validate(updatePasswordSchema),
  UserController.updatePassword,
);

/**
 * @route   GET /api/v1/users/profile/:username
 * @desc    Get another user's profile
 * @access  Private
 *
 * Every profile requires authentication, irrespective of its
 * public/private visibility setting.
 */
router.get("/profile/:username", authenticate, UserController.getProfile);

/**
 * @route   POST /api/v1/users/:id/follow
 * @desc    Toggle follow/unfollow for a user
 * @access  Private
 */
router.post("/:id/follow", authenticate, UserController.toggleFollow);

/**
 * @route   PUT /api/v1/users/:id
 * @desc    Update profile fields (Fullname, Bio, Images)
 * @access  Private (Owner/Admin)
 */
router.put(
  "/:id",
  authenticate,
  authorizeProfileOwnerOrAdmin,
  upload.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "bannerImage", maxCount: 1 },
  ]),
  parseFormDataJson,
  validate(UpdateProfileSchema),
  UserController.updateProfile,
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
  UserController.deleteUser,
);

export const userRoutes = router;
