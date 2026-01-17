import { Request, Response, NextFunction } from "express";
import { userService } from "./user.service";
import { ApiResponse } from "../../shared/utils/api-response";
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
      // Safely accessing req.user due to express.d.ts
      if (!req.user?.id) {
        throw new Error("Unauthorized: User ID missing from request");
      }

      const userId = req.user.id;
      const updatedUser = await userService.updateUser(userId, req.body);

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
  ): Promise<void> => {};
}

export const userController = new UserController();
