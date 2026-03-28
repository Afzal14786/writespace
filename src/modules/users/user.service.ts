import { eq, and, sql } from "drizzle-orm";
import { db } from "../../db";
import { users, type User } from "../../db/schema/users";
import { follows } from "../../db/schema/follows";
import { AppError } from "../../shared/utils/app.error";
import { HTTP_STATUS } from "../../shared/constants/http-codes";
import type { UpdateProfileDto } from "./dtos/update-profile.dto";
import type { PublicUser } from "./interface/user.interface";

// 🔥 FIX 1: Imported the strict queue helper instead of the raw queue
import { addInteractionJob } from "../../shared/queues/interaction.queue";
import { NotificationType } from "../notification/interface/notification.interface";
// 🔥 FIX 2: Imported the notification service for the anti-spam email guard
import { notificationService } from "../notification/notification.service";

export interface UsernameAvailability {
  available: boolean;
  suggestions?: string[];
}

export class UserService {
  private static toPublicUser(user: User): PublicUser {
    // 🔥 CLEANUP: Dropped unused destructuring variables
    const { passwordHash, loginAttempts, lockUntil, googleAuth, githubAuth, ...publicFields } = user;
    
    // Satisfy the compiler that we intentionally omitted these from the return object
    void passwordHash;
    void loginAttempts;
    void lockUntil;
    void googleAuth;
    void githubAuth;
    
    return publicFields as unknown as PublicUser;
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
    let isCriticalUpdate = false; // 🔥 ANTI-SPAM FLAG

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
      const { website, github, twitter, linkedin, instagram, youtube, facebook, leetcode, geeksforgeeks, codeforces } = updateData.social_links;
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

    // 3. Extract Media Paths
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

    // 🔥 ANTI-SPAM TRIGGER: Only send email if a critical field changed
    if (isCriticalUpdate) {
      notificationService.sendProfileUpdateEmail(updated.email, updated.username)
        .catch(err => console.error("Failed to send profile update email:", err));
    }

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

    // Unfollow Logic
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
      
    } 
    // Follow Logic
    else {
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

      // 🔥 FIX 3: Correctly using the `addInteractionJob` helper so BullMQ formats it properly!
      await addInteractionJob({
        type: NotificationType.FOLLOW,
        actorId: currentUserId,
        recipientId: targetUserId,
        message: "started following you",
      });

      return { status: "followed" };
    }
  }
}