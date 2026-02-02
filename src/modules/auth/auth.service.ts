import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { eq, or } from "drizzle-orm";
import { db } from "../../db";
import { users } from "../../db/schema";
import { client as redis } from "../../config/redis";
import env from "../../config/env";
import { AppError } from "../../shared/utils/app.error";
import { HTTP_STATUS } from "../../shared/constants/http-codes";
import { notificationService } from "../notification/notification.service";
import { RegisterInput } from "./dtos/register.dto";
import { LoginInput } from "./dtos/login.dto";
import { generateOTP } from "./auth.utils";
import { IJwtPayload, IOAuthProfile } from "./interface/auth.interface";
import logger from "../../config/logger";
import { PublicUser } from "../users/interface/user.interface";

const ACCESS_TOKEN_EXPIRE = env.JWT_ACCESS_EXPIRE;
const REFRESH_TOKEN_EXPIRE = "7d";
const REFRESH_TOKEN_EXPIRE_SEC = 7 * 24 * 60 * 60;
const OTP_EXPIRE_SEC = 60;
const RESET_TOKEN_EXPIRE_SEC = 60 * 60;
const SALT_ROUNDS = 12;

function toPublicUser(user: typeof users.$inferSelect): PublicUser {
  const { passwordHash, loginAttempts, lockUntil, ...publicFields } = user;
  return publicFields;
}

class AuthService {
  public async initiateRegistration(data: RegisterInput) {
    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.email, data.email), eq(users.username, data.username)))
      .limit(1);

    if (existingUser) {
      throw new AppError(
        HTTP_STATUS.CONFLICT,
        "Email or Username already exists",
      );
    }

    const otp = generateOTP(6);

    const registrationData = { ...data, otp };
    await redis.set(
      `auth:register:${data.email}`,
      JSON.stringify(registrationData),
      { EX: OTP_EXPIRE_SEC },
    );

    await notificationService.sendOtpEmail(data.email, otp);

    return {
      message: "OTP sent to email. Please verify to complete registration.",
    };
  }

  public async verifyRegistration(email: string, otp: string) {
    const cachedData = await redis.get(`auth:register:${email}`);
    if (!cachedData) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "OTP expired or invalid");
    }

    const data = JSON.parse(cachedData);

    if (data.otp !== otp) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid OTP");
    }

    const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

    const [user] = await db
      .insert(users)
      .values({
        fullname: data.fullname,
        email: data.email,
        username: data.username,
        passwordHash,
      })
      .returning();

    await redis.del(`auth:register:${email}`);

    const tokens = await this.signTokens(user.id, user.role);

    await notificationService.sendWelcomeEmail(
      user.email,
      user.username,
      user.id,
    );

    return { user: toPublicUser(user), ...tokens };
  }

  public async login(data: LoginInput, ip: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, data.email))
      .limit(1);

    if (!user || !user.passwordHash) {
      throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Invalid email or password");
    }

    const passwordMatch = await bcrypt.compare(
      data.password,
      user.passwordHash,
    );
    if (!passwordMatch) {
      throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Invalid email or password");
    }

    const tokens = await this.signTokens(user.id, user.role);

    await notificationService.sendLoginAlert(
      user.email,
      user.username,
      ip,
      user.id,
    );

    logger.info("User logged in successfully", { userId: user.id });

    return { user: toPublicUser(user), ...tokens };
  }

  public async googleAuth(profile: IOAuthProfile) {
    return this.handleSocialAuth(profile, "googleAuth");
  }

  public async githubAuth(profile: IOAuthProfile) {
    return this.handleSocialAuth(profile, "githubAuth");
  }

  private async handleSocialAuth(
    profile: IOAuthProfile,
    providerField: "googleAuth" | "githubAuth",
  ) {
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, profile.email))
      .limit(1);

    if (existingUser) {
      if (!existingUser[providerField]) {
        await db
          .update(users)
          .set({ [providerField]: true })
          .where(eq(users.id, existingUser.id));
      }
      return this.signTokens(existingUser.id, existingUser.role);
    }

    const username =
      profile.displayName.toLowerCase().replace(/\s+/g, "") + generateOTP(4);
    const randomPassword = generateOTP(16) + "Aa1!";
    const passwordHash = await bcrypt.hash(randomPassword, SALT_ROUNDS);

    const [newUser] = await db
      .insert(users)
      .values({
        fullname: profile.displayName,
        email: profile.email,
        username,
        passwordHash,
        profileImageUrl: profile.picture || undefined,
        [providerField]: true,
      })
      .returning();

    await notificationService.sendWelcomeEmail(
      newUser.email,
      newUser.username,
      newUser.id,
    );

    return this.signTokens(newUser.id, newUser.role);
  }

  public async refreshToken(oldRefreshToken: string) {
    let decoded: IJwtPayload;
    try {
      decoded = jwt.verify(
        oldRefreshToken,
        env.JWT_REFRESH_SECRET,
      ) as IJwtPayload;
    } catch {
      throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Invalid Refresh Token");
    }

    const storedToken = await redis.get(`refresh_token:${decoded.id}`);
    if (!storedToken || storedToken !== oldRefreshToken) {
      await redis.del(`refresh_token:${decoded.id}`);
      throw new AppError(
        HTTP_STATUS.UNAUTHORIZED,
        "Session expired or invalid",
      );
    }

    const [user] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, decoded.id))
      .limit(1);

    if (!user) {
      throw new AppError(HTTP_STATUS.UNAUTHORIZED, "User not found");
    }

    return this.signTokens(user.id, user.role);
  }

  public async logout(userId: string) {
    await redis.del(`refresh_token:${userId}`);
  }

  public async forgotPassword(email: string) {
    const [user] = await db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      return { message: "If that email exists, a reset link has been sent." };
    }

    const resetToken = generateOTP(32);

    await redis.set(`password_reset:${resetToken}`, user.id, {
      EX: RESET_TOKEN_EXPIRE_SEC,
    });

    const resetUrl = `${env.CLIENT_URL}/auth/reset-password?token=${resetToken}`;
    await notificationService.sendPasswordResetEmail(
      email,
      user.username,
      resetUrl,
    );

    return { message: "If that email exists, a reset link has been sent." };
  }

  public async resetPassword(token: string, newPassword: string) {
    const userId = await redis.get(`password_reset:${token}`);
    if (!userId) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Reset token expired or invalid",
      );
    }

    const [user] = await db
      .select({ id: users.id, email: users.email, username: users.username })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "User not found");
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await db.update(users).set({ passwordHash }).where(eq(users.id, userId));

    await redis.del(`password_reset:${token}`);
    await redis.del(`refresh_token:${userId}`);

    await notificationService.sendPasswordUpdateEmail(
      user.email,
      user.username,
    );

    return { message: "Password reset successful. Please log in again." };
  }

  private async signTokens(userId: string, role: string) {
    const accessExpiry = ACCESS_TOKEN_EXPIRE as jwt.SignOptions["expiresIn"];
    const refreshExpiry = REFRESH_TOKEN_EXPIRE as jwt.SignOptions["expiresIn"];

    const accessToken = jwt.sign({ id: userId, role }, env.JWT_ACCESS_SECRET, {
      expiresIn: accessExpiry,
    });

    const refreshToken = jwt.sign(
      { id: userId, role },
      env.JWT_REFRESH_SECRET,
      { expiresIn: refreshExpiry },
    );

    await redis.set(`refresh_token:${userId}`, refreshToken, {
      EX: REFRESH_TOKEN_EXPIRE_SEC,
    });

    return { accessToken, refreshToken };
  }
}

export const authService = new AuthService();
