import { eq } from "drizzle-orm";
import { db } from "../../db";
import { users, type User } from "../../db/schema";
import { AppError } from "../../shared/utils/app.error";
import { HTTP_STATUS } from "../../shared/constants/http-codes";
import { type UpdateProfileDto } from "./dtos/update-profile.dto";
import { type PublicUser } from "./interface/user.interface";

export interface UsernameAvailability {
  available: boolean;
  suggestions?: string[];
}

class UserService {
  /**
   * Helper to strip sensitive fields (password, internal locks)
   */
  private toPublicUser(user: User): PublicUser {
    const { passwordHash, loginAttempts, lockUntil, ...publicFields } = user;
    return publicFields;
  }

  /**
   * Check if username is taken and generate unique suggestions
   */
  public async checkUsernameAvailability(username: string): Promise<UsernameAvailability> {
    const normalizedUsername = username.toLowerCase();
    
    // findFirst is faster than select().limit(1) as it avoids array overhead
    const existing = await db.query.users.findFirst({
      where: eq(users.username, normalizedUsername),
      columns: { id: true }
    });

    if (!existing) return { available: true };

    const suggestions: string[] = [];
    for (let i = 0; i < 15 && suggestions.length < 3; i++) {
      const candidate = `${normalizedUsername}${Math.floor(Math.random() * 900) + 100}`;
      const isTaken = await db.query.users.findFirst({
        where: eq(users.username, candidate),
        columns: { id: true }
      });
      if (!isTaken) suggestions.push(candidate);
    }

    return { available: false, suggestions };
  }

  public async getUserProfile(username: string): Promise<PublicUser> {
    const user = await db.query.users.findFirst({
      where: eq(users.username, username),
    });

    if (!user) throw new AppError(HTTP_STATUS.NOT_FOUND, "User not found");
    return this.toPublicUser(user);
  }

  public async getMe(userId: string): Promise<PublicUser> {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user) throw new AppError(HTTP_STATUS.NOT_FOUND, "User session invalid");
    return this.toPublicUser(user);
  }

  public async updateUser(userId: string, updateData: UpdateProfileDto): Promise<PublicUser> {
    const sanitized: Partial<User> = {};

    // Strictly map Personal Info (avoids 'any')
    if (updateData.personal_info) {
      const { fullname, bio, headline } = updateData.personal_info;
      if (fullname !== undefined) sanitized.fullname = fullname;
      if (bio !== undefined) sanitized.bio = bio;
      if (headline !== undefined) sanitized.headline = headline;
    }

    // Strictly map Social Links
    if (updateData.social_links) {
      const { twitter, github, website, linkedin, instagram, facebook, youtube } = updateData.social_links;
      if (twitter !== undefined) sanitized.twitter = twitter;
      if (github !== undefined) sanitized.github = github;
      if (website !== undefined) sanitized.website = website;
      if (linkedin !== undefined) sanitized.linkedin = linkedin;
      if (instagram !== undefined) sanitized.instagram = instagram;
      if (facebook !== undefined) sanitized.facebook = facebook;
      if (youtube !== undefined) sanitized.youtube = youtube;
    }

    if (Object.keys(sanitized).length === 0) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "No valid fields provided for update");
    }

    const [updated] = await db.update(users)
      .set({ ...sanitized, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    if (!updated) throw new AppError(HTTP_STATUS.NOT_FOUND, "User not found during update");
    return this.toPublicUser(updated);
  }

  public async deleteUser(userId: string): Promise<void> {
    const [user] = await db.update(users)
      .set({ status: "suspended" })
      .where(eq(users.id, userId))
      .returning({ id: users.id });

    if (!user) throw new AppError(HTTP_STATUS.NOT_FOUND, "User not found");
  }
}

export const userService = new UserService();