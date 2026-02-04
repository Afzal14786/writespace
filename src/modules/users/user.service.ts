import { eq } from "drizzle-orm";
import { db } from "../../db";
import { users, User } from "../../db/schema";
import { AppError } from "../../shared/utils/app.error";
import { HTTP_STATUS } from "../../shared/constants/http-codes";
import { UpdateProfileDto } from "./dtos/update-profile.dto";
import { PublicUser } from "./interface/user.interface";

const ALLOWED_PERSONAL_FIELDS: Record<string, keyof typeof users.$inferSelect> =
  {
    fullname: "fullname",
    bio: "bio",
  };

const ALLOWED_SOCIAL_FIELDS: Record<string, keyof typeof users.$inferSelect> = {
  youtube: "youtube",
  instagram: "instagram",
  facebook: "facebook",
  twitter: "twitter",
  github: "github",
  website: "website",
  linkedin: "linkedin",
};

function toPublicUser(user: User): PublicUser {
  const { passwordHash, loginAttempts, lockUntil, ...publicFields } = user;
  return publicFields;
}

class UserService {
  public async getUserProfile(username: string): Promise<PublicUser> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (!user) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "User not found");
    }

    return toPublicUser(user);
  }

  public async updateUser(
    userId: string,
    updateData: UpdateProfileDto,
  ): Promise<PublicUser> {
    const sanitized: Record<string, string> = {};

    if (updateData.personal_info) {
      for (const [field, column] of Object.entries(ALLOWED_PERSONAL_FIELDS)) {
        const value = (updateData.personal_info as Record<string, string>)[
          field
        ];
        if (value !== undefined) {
          sanitized[column] = value;
        }
      }
    }

    if (updateData.social_links) {
      for (const [field, column] of Object.entries(ALLOWED_SOCIAL_FIELDS)) {
        const value = (updateData.social_links as Record<string, string>)[
          field
        ];
        if (value !== undefined) {
          sanitized[column] = value;
        }
      }
    }

    if (Object.keys(sanitized).length === 0) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "No valid fields to update");
    }

    const [user] = await db
      .update(users)
      .set(sanitized)
      .where(eq(users.id, userId))
      .returning();

    if (!user) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "User not found");
    }

    return toPublicUser(user);
  }

  public async deleteUser(userId: string): Promise<void> {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "User not found");
    }

    await db
      .update(users)
      .set({ status: "suspended" })
      .where(eq(users.id, userId));
  }
}

export const userService = new UserService();
