import { Request, Response, NextFunction } from "express";
import { userService } from "./user.service";
import { ApiResponse } from "../../shared/utils/api-response";
import { AppError } from "../../shared/utils/app.error";
import { HTTP_STATUS } from "../../shared/constants/http-codes";

/**
 * @class UserController
 * @description Handles incoming HTTP requests for User resources.
 * Parses requests, calls the Service layer, and sends standardized responses.
 */
class UserController {
  /**
   * GET /api/users/:username
   * Fetches public profile details for a specific user.
   * @param {Request} req - Express Request object. Expects `username` in params.
   * @param {Response} res - Express Response object.
   * @param {NextFunction} next - Express NextFunction for error handling.
   */
  public getProfile = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const username = req.params.username as string;
      const user = await userService.getUserProfile(username);

      // Now strictly typed: <Partial<IUser>> is inferred from the 'user' variable
      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Profile fetched successfully",
        user,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * PUT /api/users/profile
   * Updates the authenticated user's profile.
   * @param {Request} req - Express Request object containing 'user'.
   * @param {Response} res - Express Response object.
   * @param {NextFunction} next - Express NextFunction.
   */
  public updateProfile = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new Error("Unauthorized: User ID missing from request");
      }

      const targetId = req.params.id as string;
      const isAdmin = req.user.role === "admin";

      // Only admins can update other users' profiles
      if (targetId !== req.user.id && !isAdmin) {
        throw new AppError(
          HTTP_STATUS.FORBIDDEN,
          "You can only update your own profile",
        );
      }

      const { personal_info, social_links } = req.body;
      const updatedUser = await userService.updateUser(targetId, {
        personal_info,
        social_links,
      });

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Profile updated successfully",
        updatedUser,
      ).send();
    } catch (error) {
      next(error);
    }
  };

  public deleteUser = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new AppError(
          HTTP_STATUS.UNAUTHORIZED,
          "User ID missing from request",
        );
      }

      const targetId = req.params.id as string;
      const isAdmin = req.user.role === "admin";

      if (targetId !== req.user.id && !isAdmin) {
        throw new AppError(
          HTTP_STATUS.FORBIDDEN,
          "You can only delete your own account",
        );
      }

      await userService.deleteUser(targetId);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "User deleted successfully",
        null,
      ).send();
    } catch (error) {
      next(error);
    }
  };
}

export const userController = new UserController();
