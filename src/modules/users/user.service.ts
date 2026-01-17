import { User } from "./user.model";
import { IUser } from "./interface/user.interface";
import { AppError } from "../../shared/utils/app.error";
import { HTTP_STATUS } from "../../shared/constants/http-codes";

/**
 * @class UserService
 * @description Handles business logic for User operations.
 * Acts as the bridge between the Controller and the Database.
 */

class UserService {
  /**
   * Retrieves a user's public profile by their username.
   * * @param {string} username - The unique username to search for.
   * @returns {Promise<Partial<IUser>>} The sanitized public profile.
   * @throws {AppError} 404 if the user does not exist.
   */

  public async getUserProfile(username: string): Promise<Partial<IUser>> {
    const user = await User.findOne({ "personal_info.username": username });
    if (!user) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "User not found");
    }
    return user.getPublicProfile();
  }

  /**
   * Updates a user's profile data.
   * Uses MongoDB dot notation to perform partial updates without overwriting the entire document.
   * * @param {string} userId - The ID of the user to update.
   * @param {any} updateData - The partial data object (validated by DTO) containing fields to update.
   * @returns {Promise<IUser>} The updated user document.
   * @throws {AppError} 404 if the user ID is invalid or not found.
   */

  public async updateUser(userId: string, updateData: unknown): Promise<IUser> {
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updateData as any },
      {
        new: true,
        runValidators: true,
      },
    );

    if (!user) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "User not found");
    }
    return user as IUser;
  }
}

export const userService = new UserService();
