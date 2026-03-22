import { Request, Response, NextFunction } from "express";
import { userService } from "./user.service";
import { ApiResponse } from "../../shared/utils/api-response";
import { HTTP_STATUS } from "../../shared/constants/http-codes";
import { AppError } from "../../shared/utils/app.error";

class UserController {
  /**
   * GET /api/v1/users/check-username?username=afzal
   */
  public checkUsername = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Explicitly cast to string to satisfy TS
      const username = req.query.username as string;
      
      if (!username) {
        throw new AppError(HTTP_STATUS.BAD_REQUEST, "Username query parameter is required");
      }
      
      const result = await userService.checkUsernameAvailability(username);
      
      new ApiResponse(
        res, 
        HTTP_STATUS.OK, 
        "Username availability checked", 
        result
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/users/me
   */
  public getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Session expired or invalid.");
      }
      
      const userRecord = await userService.getMe(req.user.id);
      
      new ApiResponse(
        res, 
        HTTP_STATUS.OK, 
        "Current user record retrieved", 
        userRecord
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/users/profile/:username
   */
  public getProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // FIX: Destructure correctly from req.params
      const { username } = req.params;
      
      if (!username) {
        throw new AppError(HTTP_STATUS.BAD_REQUEST, "Username parameter is required");
      }
      
      const publicProfile = await userService.getUserProfile(username);
      
      new ApiResponse(
        res, 
        HTTP_STATUS.OK, 
        "User profile retrieved successfully", 
        publicProfile
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * PUT /api/v1/users/:id
   */
  public updateProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // FIX: Force TS to treat this as string
      const id = req.params.id as string;
      
      if (!req.user) {
        throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Authentication required");
      }

      if (id !== req.user.id && req.user.role !== "admin") {
        throw new AppError(HTTP_STATUS.FORBIDDEN, "You do not have permission to update this profile");
      }
      
      const updatedUser = await userService.updateUser(id, req.body);
      
      new ApiResponse(
        res, 
        HTTP_STATUS.OK, 
        "Profile updated successfully", 
        updatedUser
      ).send();
    } catch (error) {
      next(error);
    }
  };

  /**
   * DELETE /api/v1/users/:id
   */
  public deleteUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // FIX: Force TS to treat this as string
      const id = req.params.id as string;
      
      if (!req.user) {
        throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Authentication required");
      }

      if (id !== req.user.id && req.user.role !== "admin") {
        throw new AppError(HTTP_STATUS.FORBIDDEN, "You do not have permission to delete this account");
      }

      await userService.deleteUser(id);
      
      new ApiResponse(
        res, 
        HTTP_STATUS.OK, 
        "Account has been successfully suspended", 
        null
      ).send();
    } catch (error) {
      next(error);
    }
  };
}

export const userController = new UserController();