import { Request, Response, NextFunction } from "express";
import { UserService } from "./user.service";
import { ApiResponse } from "@shared/utils/api-response";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import { AppError } from "@shared/utils/app.error";
import { generateProfileOgImage } from "@shared/utils/og-generator";
import type { CloudinaryFilesMap } from "@shared/types/cloudinary-file";
import type { UpdateProfileDto } from "./dtos/update-profile.dto";
import type { UpdatePasswordInput } from "./dtos/update-password.dto";
import { followService } from "../interactions/services/follow.service";

export class UserController {
  /**
   * GET /api/v1/users/check-username?username=afzal
   */
  public static async checkUsername(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const username = req.query.username;

      if (typeof username !== "string" || !username.trim()) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "Username query parameter is required",
        );
      }

      const result = await UserService.checkUsernameAvailability(username);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Username availability checked",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/users/search?q=afzal
   */
  public static async searchUsers(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const query = req.query.q as string;

      const results = await UserService.searchUsers(query || "");

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Search results retrieved",
        results,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/users/me
   */
  public static async getMe(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new AppError(
          HTTP_STATUS.UNAUTHORIZED,
          "Session expired or invalid.",
        );
      }

      const userRecord = await UserService.getMe(req.user.id);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Current user record retrieved",
        userRecord,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/v1/users/me/password
   *
   * Changes the authenticated user's password.
   */
  public static async updatePassword(
    req: Request<Record<string, never>, unknown, UpdatePasswordInput>,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Authentication required");
      }

      const result = await UserService.updatePassword(req.user.id, req.body);

      new ApiResponse(res, HTTP_STATUS.OK, result.message, null).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/users/profile/:username
   */
  public static async getProfile(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new AppError(
          HTTP_STATUS.UNAUTHORIZED,
          "Authentication required to view profiles",
        );
      }

      const username = req.params.username as string;

      if (!username) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "Username parameter is required",
        );
      }

      const profile = await UserService.getUserProfile(username, req.user.id);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "User profile retrieved successfully",
        profile,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/v1/users/:id
   */
  public static async updateProfile(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const id = req.params.id as string;

      if (!req.user) {
        throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Authentication required");
      }

      if (id !== req.user.id && req.user.role !== "admin") {
        throw new AppError(
          HTTP_STATUS.FORBIDDEN,
          "You do not have permission to update this profile",
        );
      }

      const updateData = req.body as UpdateProfileDto;

      const files = req.files as CloudinaryFilesMap | undefined;

      const profileFile = files?.profileImage?.[0];
      const bannerFile = files?.bannerImage?.[0];

      const mediaPaths = {
        profileImage: profileFile
          ? { url: profileFile.location, publicId: profileFile.public_id }
          : undefined,
        bannerImage: bannerFile
          ? { url: bannerFile.location, publicId: bannerFile.public_id }
          : undefined,
      };

      const updatedUser = await UserService.updateUser(
        id,
        updateData,
        mediaPaths,
      );

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Profile updated successfully",
        updatedUser,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/users/:id
   */
  public static async deleteUser(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const id = req.params.id as string;

      if (!req.user) {
        throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Authentication required");
      }

      if (id !== req.user.id && req.user.role !== "admin") {
        throw new AppError(
          HTTP_STATUS.FORBIDDEN,
          "You do not have permission to delete this account",
        );
      }

      await UserService.deleteUser(id);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Account has been successfully suspended",
        null,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/users/:id/follow
   */
  public static async toggleFollow(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new AppError(
          HTTP_STATUS.UNAUTHORIZED,
          "Authentication required to follow users",
        );
      }

      const currentUserId = req.user.id;
      const targetUserId = req.params.id as string;

      // Delegate to the shared follow service to avoid duplicate business logic.
      const result = await followService.toggleFollow({
        actorId: currentUserId,
        targetUserId,
      });

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Follow status updated successfully",
        result,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/users/og/:username
   * Dynamically generates and returns a PNG image for Open Graph sharing.
   */
  public static async getProfileDynamicOgImage(
    req: Request,
    res: Response,
  ): Promise<void> {
    try {
      const username = req.params.username as string;

      if (!username) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "Username parameter is required",
        );
      }

      // Fetch the raw user data required for the image
      const userData = await UserService.getRawUserDataForOgImage(username);

      // Format Avatar URL (Satori needs absolute URLs)
      let absoluteAvatarUrl = userData.profileImageUrl;
      if (absoluteAvatarUrl && absoluteAvatarUrl.startsWith("/")) {
        absoluteAvatarUrl = `${req.protocol}://${req.get("host")}${absoluteAvatarUrl}`;
      }

      // Generate the raw PNG Buffer using our new utility
      const pngBuffer = await generateProfileOgImage({
        username: userData.username,
        fullname: userData.fullname,
        headline: userData.headline,
        avatar: absoluteAvatarUrl,
      });

      // Send the image directly to the browser/bot (Bypassing standard JSON ApiResponse)
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400"); // Cache for 24 hours
      res.status(HTTP_STATUS.OK).send(pngBuffer);
    } catch (error) {
      // If image generation fails, don't crash the server, just send a 404 or default image
      console.error("[OG-IMAGE-GEN-ERROR]", error);
      res.status(HTTP_STATUS.NOT_FOUND).send("Image generation failed");
    }
  }
}
