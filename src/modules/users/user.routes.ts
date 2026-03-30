import { Router } from "express";
import { UserController } from "./user.controller";
import { authenticate, authorize } from "../../shared/middlewares/auth.middleware";
import { validate } from "../../shared/middlewares/validate.middleware";
import { parseFormDataJson } from "../../shared/middlewares/parse-form-data.middleware";
import { upload } from "../../shared/middlewares/upload.middleware";
import { UpdateProfileSchema } from "./dtos/update-profile.dto";

const router = Router();

/**
 * @route   GET /api/v1/users/check-username
 * @desc    Check if a username is available during registration
 * @access  Public
 */
router.get("/check-username", UserController.checkUsername);
router.get("/og/:username", UserController.getProfileDynamicOgImage);

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
 * @route   GET /api/v1/users/profile/:username
 * @desc    Get public profile data by username (attaches follow stats if logged in)
 * @access  Public (Optional Auth)
 */
// We use a custom auth check here so non-logged in users can still view profiles
router.get("/profile/:username", (req, res, next) => {
  authenticate(req, res, () => next());
}, UserController.getProfile);

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
  authorize("admin", "user"),
  upload.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "bannerImage", maxCount: 1 }
  ]),
  parseFormDataJson,
  validate(UpdateProfileSchema),
  UserController.updateProfile
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
  UserController.deleteUser
);

export const userRoutes = router;