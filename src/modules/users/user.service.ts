import { eq, and, ilike, or } from "drizzle-orm";
import { db } from "../../db";
import { users, type User } from "../../db/schema/users";
import { follows } from "../../db/schema/follows";
import bcrypt from "bcryptjs";
import { authService } from "../auth/auth.service";
import type { UpdatePasswordInput } from "./dtos/update-password.dto";
import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import type { UpdateProfileDto } from "./dtos/update-profile.dto";
import type { PublicUser, PublicProfile } from "./interface/user.interface";

const SALT_ROUNDS = 12;

import { notificationService } from "../notification/notification.service";

export interface UsernameAvailability {
  available: boolean;
  suggestions?: string[];
}

export class UserService {
  private static toPublicUser(user: User): PublicUser {
    // Keep the original database record unchanged.
    const publicFields = { ...user };

    // Remove sensitive authentication and account-management fields.
    Reflect.deleteProperty(publicFields, "passwordHash");
    Reflect.deleteProperty(publicFields, "loginAttempts");
    Reflect.deleteProperty(publicFields, "lockUntil");
    Reflect.deleteProperty(publicFields, "googleAuth");
    Reflect.deleteProperty(publicFields, "githubAuth");

    return publicFields as PublicUser;
  }

  public static async checkUsernameAvailability(
    username: string,
  ): Promise<UsernameAvailability> {
    const normalizedUsername = username.trim().toLowerCase();

    if (!normalizedUsername) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Username cannot be empty");
    }

    const existing = await db.query.users.findFirst({
      where: eq(users.username, normalizedUsername),
      columns: { id: true },
    });

    if (!existing) return { available: true };

    const suggestions: string[] = [];
    for (let i = 0; i < 15 && suggestions.length < 3; i++) {
      const candidate = `${normalizedUsername}${Math.floor(Math.random() * 900) + 100}`;
      const isTaken = await db.query.users.findFirst({
        where: eq(users.username, candidate),
        columns: { id: true },
      });
      if (!isTaken) suggestions.push(candidate);
    }

    return { available: false, suggestions };
  }

  /**
   * Search users by username or fullname
   */
  public static async searchUsers(query: string, limitCount = 5) {
    if (!query || query.trim() === "") return [];

    const searchPattern = `%${query}%`;

    const results = await db.query.users.findMany({
      where: and(
        eq(users.status, "active"),
        or(
          ilike(users.username, searchPattern),
          ilike(users.fullname, searchPattern),
        ),
      ),
      columns: {
        id: true,
        username: true,
        fullname: true,
        profileImageUrl: true,
        headline: true,
      },
      limit: limitCount,
    });

    return results;
  }

  public static async getUserProfile(
    username: string,
    currentUserId: string,
  ): Promise<PublicProfile & { isFollowingByMe: boolean }> {
    const normalizedUsername = username.trim().toLowerCase();

    const user = await db.query.users.findFirst({
      where: and(
        eq(users.username, normalizedUsername),
        eq(users.status, "active"),
      ),
      columns: {
        id: true,
        fullname: true,
        username: true,
        bio: true,
        headline: true,
        location: true,
        profileImageUrl: true,
        bannerImageUrl: true,

        youtube: true,
        instagram: true,
        facebook: true,
        twitter: true,
        github: true,
        website: true,
        linkedin: true,
        leetcode: true,
        geeksforgeeks: true,
        codeforces: true,

        totalPosts: true,
        totalReads: true,
        totalFollowers: true,
        totalFollowing: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "User not found");
    }

    let isFollowingByMe = false;

    if (currentUserId !== user.id) {
      const [followRecord] = await db
        .select({ followerId: follows.followerId })
        .from(follows)
        .where(
          and(
            eq(follows.followerId, currentUserId),
            eq(follows.followingId, user.id),
          ),
        )
        .limit(1);

      isFollowingByMe = Boolean(followRecord);
    }

    return {
      ...user,
      isFollowingByMe,
    };
  }

  public static async getMe(userId: string): Promise<PublicUser> {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user)
      throw new AppError(HTTP_STATUS.NOT_FOUND, "User session invalid");
    return this.toPublicUser(user);
  }

  public static async updateUser(
    userId: string,
    updateData: UpdateProfileDto,
    mediaPaths?: {
      profileImage?: { url: string; publicId: string };
      bannerImage?: { url: string; publicId: string };
    },
  ): Promise<PublicUser> {
    const sanitized: Partial<User> = {};
    let isCriticalUpdate = false;

    // 1. Extract Personal Info
    if (updateData.personal_info) {
      const { fullname, bio, headline, location } = updateData.personal_info;

      if (fullname !== undefined) {
        sanitized.fullname = fullname;
        isCriticalUpdate = true; // Name change warrants an email
      }

      if (bio !== undefined) sanitized.bio = bio;
      if (headline !== undefined) sanitized.headline = headline;
      if (location !== undefined) sanitized.location = location;
    }

    // 2. Extract Social Links
    if (updateData.social_links) {
      const {
        website,
        github,
        twitter,
        linkedin,
        instagram,
        youtube,
        facebook,
        leetcode,
        geeksforgeeks,
        codeforces,
      } = updateData.social_links;
      if (website !== undefined) sanitized.website = website;
      if (github !== undefined) sanitized.github = github;
      if (twitter !== undefined) sanitized.twitter = twitter;
      if (linkedin !== undefined) sanitized.linkedin = linkedin;
      if (instagram !== undefined) sanitized.instagram = instagram;
      if (youtube !== undefined) sanitized.youtube = youtube;
      if (facebook !== undefined) sanitized.facebook = facebook;
      if (leetcode !== undefined) sanitized.leetcode = leetcode;
      if (geeksforgeeks !== undefined) sanitized.geeksforgeeks = geeksforgeeks;
      if (codeforces !== undefined) sanitized.codeforces = codeforces;
    }

    // 3. Extract Media Paths (Cloudinary)
    if (mediaPaths?.profileImage) {
      sanitized.profileImageUrl = mediaPaths.profileImage.url;
      sanitized.profileImagePublicId = mediaPaths.profileImage.publicId;
    }

    if (mediaPaths?.bannerImage) {
      sanitized.bannerImageUrl = mediaPaths.bannerImage.url;
      sanitized.bannerImagePublicId = mediaPaths.bannerImage.publicId;
    }

    if (Object.keys(sanitized).length === 0) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "No valid fields provided for update",
      );
    }

    const [updated] = await db
      .update(users)
      .set({ ...sanitized, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    if (!updated)
      throw new AppError(HTTP_STATUS.NOT_FOUND, "User not found during update");

    if (isCriticalUpdate) {
      notificationService
        .sendProfileUpdateEmail(updated.email, updated.username)
        .catch((err) =>
          console.error("Failed to send profile update email:", err),
        );
    }

    return this.toPublicUser(updated);
  }

  /**
   * Changes the password of an authenticated user.
   *
   * The user must provide the current password before a new password
   * can be saved. Existing refresh-token sessions are revoked afterward.
   */
  public static async updatePassword(
    userId: string,
    data: UpdatePasswordInput,
  ): Promise<{ message: string }> {
    const [user] = await db
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        email: users.email,
        username: users.username,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user || !user.passwordHash) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "User not found or uses social login without a password.",
      );
    }

    const isMatch = await bcrypt.compare(
      data.currentPassword,
      user.passwordHash,
    );

    if (!isMatch) {
      throw new AppError(
        HTTP_STATUS.UNAUTHORIZED,
        "Incorrect current password",
      );
    }

    const newPasswordHash = await bcrypt.hash(data.newPassword, SALT_ROUNDS);

    await db
      .update(users)
      .set({ passwordHash: newPasswordHash })
      .where(eq(users.id, userId));

    // Revoke existing refresh-token sessions after the password changes.
    await authService.revokeAllRefreshTokens(userId);

    // Email notification is best-effort.
    // A queue failure must not make a successful password change appear to fail.
    try {
      await notificationService.sendPasswordUpdateEmail(
        user.email,
        user.username,
      );
    } catch (error) {
      console.error("Failed to send password update email:", {
        userId,
        error,
      });
    }

    return { message: "Password updated successfully" };
  }

  public static async deleteUser(userId: string): Promise<void> {
    const [user] = await db
      .update(users)
      .set({ status: "suspended" })
      .where(eq(users.id, userId))
      .returning({ id: users.id });

    if (!user) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "User not found");
    }

    // A suspended account must not retain usable refresh-token sessions.
    try {
      await authService.revokeAllRefreshTokens(userId);
    } catch (error) {
      // The account suspension is already persisted.
      // Refresh-token rotation also independently checks account status.
      console.error("Failed to revoke refresh tokens for suspended user:", {
        userId,
        error,
      });
    }
  }

  /**
   * Extremely fast, raw DB query used specifically for generating Open Graph Images.
   */
  public static async getRawUserDataForOgImage(username: string) {
    const user = await db.query.users.findFirst({
      where: eq(users.username, username),
      columns: {
        username: true,
        fullname: true,
        headline: true,
        profileImageUrl: true,
      },
    });

    if (!user) {
      throw new AppError(
        HTTP_STATUS.NOT_FOUND,
        "User not found for OG generation",
      );
    }

    return user;
  }
}
