import { eq, and, sql } from "drizzle-orm";
import { db } from "../../db";
import { users, type User } from "../../db/schema/users";
import { follows } from "../../db/schema/follows";
import { AppError } from "../../shared/utils/app.error";
import { HTTP_STATUS } from "../../shared/constants/http-codes";
import type { UpdateProfileDto } from "./dtos/update-profile.dto";
import type { PublicUser } from "./interface/user.interface";
import { interactionQueue } from "../../shared/queues/interaction.queue";
import { NotificationType } from "../notification/interface/notification.interface";

export interface UsernameAvailability {
  available: boolean;
  suggestions?: string[];
}

export class UserService {
  private static toPublicUser(user: User): PublicUser {
    const { passwordHash, loginAttempts, lockUntil, ...publicFields } = user;
    
    void passwordHash;
    void loginAttempts;
    void lockUntil;
    
    return publicFields;
  }

  public static async checkUsernameAvailability(username: string): Promise<UsernameAvailability> {
    const normalizedUsername = username.toLowerCase();
    
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

  public static async getUserProfile(username: string, currentUserId?: string): Promise<PublicUser & { isFollowingByMe: boolean }> {
    const user = await db.query.users.findFirst({
      where: eq(users.username, username),
    });

    if (!user) throw new AppError(HTTP_STATUS.NOT_FOUND, "User not found");

    let isFollowingByMe = false;
    if (currentUserId && currentUserId !== user.id) {
      const [followRecord] = await db
        .select()
        .from(follows)
        .where(and(eq(follows.followerId, currentUserId), eq(follows.followingId, user.id)));
      
      if (followRecord) isFollowingByMe = true;
    }

    // 🔥 FIX 3: We no longer run COUNT() queries. We instantly return the user's built-in counters.
    return {
      ...this.toPublicUser(user),
      isFollowingByMe,
    };
  }

  public static async getMe(userId: string): Promise<PublicUser> {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    
    if (!user) throw new AppError(HTTP_STATUS.NOT_FOUND, "User session invalid");
    return this.toPublicUser(user);
  }

  public static async updateUser(userId: string, updateData: UpdateProfileDto, mediaPaths?: { profileImage?: string; bannerImage?: string }): Promise<PublicUser> {
    const sanitized: Partial<User> = {};

    if (updateData.personal_info) {
      const { fullname, bio, headline, location } = updateData.personal_info;
      if (fullname !== undefined) sanitized.fullname = fullname;
      if (bio !== undefined) sanitized.bio = bio;
      if (headline !== undefined) sanitized.headline = headline;
      if (location !== undefined) sanitized.location = location; 
    }

    if (mediaPaths?.profileImage) {
      const formattedPath = mediaPaths.profileImage.replace(/\\/g, '/');
      sanitized.profileImageUrl = formattedPath.startsWith('/uploads/') ? formattedPath : `/${formattedPath}`;
    }

    if (mediaPaths?.bannerImage) {
      const formattedPath = mediaPaths.bannerImage.replace(/\\/g, '/');
      sanitized.bannerImageUrl = formattedPath.startsWith('/uploads/') ? formattedPath : `/${formattedPath}`;
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

  public static async deleteUser(userId: string): Promise<void> {
    const [user] = await db.update(users)
      .set({ status: "suspended" })
      .where(eq(users.id, userId))
      .returning({ id: users.id });

    if (!user) throw new AppError(HTTP_STATUS.NOT_FOUND, "User not found");
  }

  public static async toggleFollow(currentUserId: string, targetUserId: string): Promise<{ status: "followed" | "unfollowed" }> {
    if (currentUserId === targetUserId) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "You cannot follow yourself");
    }

    const targetUser = await db.query.users.findFirst({
      where: eq(users.id, targetUserId),
    });

    if (!targetUser) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "User not found");
    }

    const existingFollow = await db.query.follows.findFirst({
      where: and(
        eq(follows.followerId, currentUserId),
        eq(follows.followingId, targetUserId)
      ),
    });

    if (existingFollow) {
      await db.transaction(async (tx) => {
        await tx.delete(follows).where(
          and(
            eq(follows.followerId, currentUserId),
            eq(follows.followingId, targetUserId)
          )
        );
        
        await tx.update(users)
          .set({ totalFollowers: sql`GREATEST(${users.totalFollowers} - 1, 0)` })
          .where(eq(users.id, targetUserId));
          
        await tx.update(users)
          .set({ totalFollowing: sql`GREATEST(${users.totalFollowing} - 1, 0)` })
          .where(eq(users.id, currentUserId));
      });

      return { status: "unfollowed" };
      
    } else {
      await db.transaction(async (tx) => {
        await tx.insert(follows).values({
          followerId: currentUserId,
          followingId: targetUserId,
        });

        await tx.update(users)
          .set({ totalFollowers: sql`${users.totalFollowers} + 1` })
          .where(eq(users.id, targetUserId));
          
        await tx.update(users)
          .set({ totalFollowing: sql`${users.totalFollowing} + 1` })
          .where(eq(users.id, currentUserId));
      });

      await interactionQueue.add("processInteraction", {
        type: NotificationType.FOLLOW,
        actorId: currentUserId,
        recipientId: targetUserId,
        message: "started following you"
      });

      return { status: "followed" };
    }
  }
}