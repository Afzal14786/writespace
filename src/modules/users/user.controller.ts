import { Request, Response, NextFunction } from "express";
import { UserService } from "./user.service";
import { ApiResponse } from "../../shared/utils/api-response";
import { HTTP_STATUS } from "../../shared/constants/http-codes";
import { AppError } from "../../shared/utils/app.error";
import { generateProfileOgImage } from '../../shared/utils/og-generator';
import type { UpdateProfileDto } from "./dtos/update-profile.dto";

export class UserController {
  /**
   * GET /api/v1/users/check-username?username=afzal
   */
  public static async checkUsername(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const username = req.query.username as string;
      
      if (!username) {
        throw new AppError(HTTP_STATUS.BAD_REQUEST, "Username query parameter is required");
      }
      
      const result = await UserService.checkUsernameAvailability(username);
      
      new ApiResponse(
        res, 
        HTTP_STATUS.OK, 
        "Username availability checked", 
        result
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/users/me
   */
  public static async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Session expired or invalid.");
      }
      
      const userRecord = await UserService.getMe(req.user.id);
      
      new ApiResponse(
        res, 
        HTTP_STATUS.OK, 
        "Current user record retrieved", 
        userRecord
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/users/profile/:username
   */
  public static async getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const username = req.params.username as string;
      const currentUserId = req.user?.id; 
      
      if (!username) {
        throw new AppError(HTTP_STATUS.BAD_REQUEST, "Username parameter is required");
      }
      
      const publicProfile = await UserService.getUserProfile(username, currentUserId);
      
      new ApiResponse(
        res, 
        HTTP_STATUS.OK, 
        "User profile retrieved successfully", 
        publicProfile
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/v1/users/:id
   */
  public static async updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      
      if (!req.user) {
        throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Authentication required");
      }

      if (id !== req.user.id && req.user.role !== "admin") {
        throw new AppError(HTTP_STATUS.FORBIDDEN, "You do not have permission to update this profile");
      }
      
      const updateData = req.body as UpdateProfileDto;
      
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      
      const mediaPaths = {
        profileImage: files?.profileImage?.[0]?.path,
        bannerImage: files?.bannerImage?.[0]?.path,
      };
      
      const updatedUser = await UserService.updateUser(id, updateData, mediaPaths);
      
      new ApiResponse(
        res, 
        HTTP_STATUS.OK, 
        "Profile updated successfully", 
        updatedUser
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/users/:id
   */
  public static async deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      
      if (!req.user) {
        throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Authentication required");
      }

      if (id !== req.user.id && req.user.role !== "admin") {
        throw new AppError(HTTP_STATUS.FORBIDDEN, "You do not have permission to delete this account");
      }

      await UserService.deleteUser(id);
      
      new ApiResponse(
        res, 
        HTTP_STATUS.OK, 
        "Account has been successfully suspended", 
        null
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/users/:id/follow
   */
  public static async toggleFollow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Authentication required to follow users");
      }

      const currentUserId = req.user.id;
      const targetUserId = req.params.id as string;

      const result = await UserService.toggleFollow(currentUserId, targetUserId);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Follow status updated successfully",
        result
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/users/og/:username
   * Dynamically generates and returns a PNG image for Open Graph sharing.
   */
  public static async getProfileDynamicOgImage(req: Request, res: Response): Promise<void> {
    try {
      const username = req.params.username as string;
      
      if (!username) {
        throw new AppError(HTTP_STATUS.BAD_REQUEST, "Username parameter is required");
      }

      // Fetch the raw user data required for the image
      const userData = await UserService.getRawUserDataForOgImage(username);

      // Format Avatar URL (Satori needs absolute URLs)
      let absoluteAvatarUrl = userData.profileImageUrl;
      if (absoluteAvatarUrl && absoluteAvatarUrl.startsWith('/')) {
        absoluteAvatarUrl = `${req.protocol}://${req.get('host')}${absoluteAvatarUrl}`;
      }

      // Generate the raw PNG Buffer using our new utility
      const pngBuffer = await generateProfileOgImage({
        username: userData.username,
        fullname: userData.fullname,
        headline: userData.headline,
        avatar: absoluteAvatarUrl
      });

      // Send the image directly to the browser/bot (Bypassing standard JSON ApiResponse)
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
      res.status(HTTP_STATUS.OK).send(pngBuffer);

    } catch (error) {
      // If image generation fails, don't crash the server, just send a 404 or default image
      console.error('[OG-IMAGE-GEN-ERROR]', error);
      res.status(HTTP_STATUS.NOT_FOUND).send('Image generation failed');
    }
  }
}