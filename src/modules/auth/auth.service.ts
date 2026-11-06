import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { eq, or } from "drizzle-orm";
import { db } from "../../db";
import { users, type User } from "../../db/schema";
import { client as redis } from "@config/redis";
import env from "@config/env";
import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import { notificationService } from "../notification/notification.service";
import { RegisterInput } from "./dtos/register.dto";
import { LoginInput } from "./dtos/login.dto";
import { generateOTP } from "./auth.utils";
import { IJwtPayload, IOAuthProfile } from "./interface/auth.interface";
import logger from "@config/logger";
import { PublicUser } from "../users/interface/user.interface";

const ACCESS_TOKEN_EXPIRE = env.JWT_ACCESS_EXPIRE;
const REFRESH_TOKEN_EXPIRE = "7d";
const REFRESH_TOKEN_EXPIRE_SEC = 7 * 24 * 60 * 60;
const OTP_EXPIRE_SEC = 10 * 60;
const RESET_TOKEN_EXPIRE_SEC = 60 * 60;
const SALT_ROUNDS = 12;

/**
 * Temporary registration data stored in Redis.
 *
 * Never store the user's plaintext password in the registration cache.
 */
type PendingRegistration = Omit<RegisterInput, "password"> & {
  passwordHash: string;
  otp: string;
};

function isPendingRegistration(value: unknown): value is PendingRegistration {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.fullname === "string" &&
    typeof candidate.username === "string" &&
    typeof candidate.email === "string" &&
    typeof candidate.passwordHash === "string" &&
    typeof candidate.otp === "string" &&
    /^\d{6}$/.test(candidate.otp)
  );
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates the decoded refresh-token payload at runtime.
 * A TypeScript type assertion alone does not validate JWT contents.
 */
function isValidRefreshTokenPayload(payload: unknown): payload is IJwtPayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;

  return (
    typeof candidate.id === "string" &&
    UUID_REGEX.test(candidate.id) &&
    (candidate.role === "user" || candidate.role === "admin")
  );
}

type AuthPublicUser = Omit<PublicUser, "googleAuth" | "githubAuth">;

function toPublicUser(user: typeof users.$inferSelect): AuthPublicUser {
  // create a separate object so the original database result remains unchanged.
  const publicFields = { ...user };

  // remove sensitive authentication and account-management fields.
  Reflect.deleteProperty(publicFields, "passwordHash");
  Reflect.deleteProperty(publicFields, "loginAttempts");
  Reflect.deleteProperty(publicFields, "lockUntil");

  // authentication provider flags are internal implementation details.
  Reflect.deleteProperty(publicFields, "googleAuth");
  Reflect.deleteProperty(publicFields, "githubAuth");

  return publicFields;
}

class AuthService {
  /**
   * Executes a secondary notification without changing the outcome
   * of an authentication operation that has already succeeded.
   *
   * Email and notification delivery failures are logged for investigation.
   */
  private async runNotificationSafely(
    notificationName: string,
    context: {
      userId?: string;
      email?: string;
    },
    send: () => Promise<void>,
  ): Promise<void> {
    try {
      await send();
    } catch (error) {
      logger.error(`Failed to process ${notificationName}`, {
        ...context,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

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

    const { password, ...registrationFields } = data;
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const registrationData: PendingRegistration = {
      ...registrationFields,
      passwordHash,
      otp,
    };
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
    const registrationKey = `auth:register:${email}`;

    // 1. Read pending registration data.
    const cachedData = await redis.get(registrationKey);

    if (!cachedData) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "OTP expired or invalid");
    }

    // 2. Parse and validate cached registration data.
    let parsedData: unknown;

    try {
      parsedData = JSON.parse(cachedData) as unknown;
    } catch {
      await redis.del(registrationKey);

      throw new AppError(HTTP_STATUS.BAD_REQUEST, "OTP expired or invalid");
    }

    if (!isPendingRegistration(parsedData) || parsedData.email !== email) {
      await redis.del(registrationKey);

      throw new AppError(HTTP_STATUS.BAD_REQUEST, "OTP expired or invalid");
    }

    // 3. Reject an incorrect OTP without consuming the valid one.
    if (parsedData.otp !== otp) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid OTP");
    }

    // 4. Atomically consume the OTP.
    // Only one concurrent verification request can successfully consume it.
    const consumedData = await redis.getDel(registrationKey);

    if (consumedData !== cachedData) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "OTP expired or invalid");
    }

    // 5. Create the account after successful OTP consumption.
    const [user] = await db
      .insert(users)
      .values({
        fullname: parsedData.fullname,
        email: parsedData.email,
        username: parsedData.username,
        passwordHash: parsedData.passwordHash,
      })
      .returning();

    // 6. Issue authentication tokens.
    const tokens = await this.signTokens(user.id, user.role);

    // 7. Send the welcome notification without affecting registration success.
    await this.runNotificationSafely(
      "registration welcome notification",
      {
        userId: user.id,
        email: user.email,
      },
      () =>
        notificationService.sendWelcomeEmail(
          user.email,
          user.username,
          user.id,
        ),
    );

    return {
      user: toPublicUser(user),
      ...tokens,
    };
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

    this.ensureAccountIsActive(user.status);

    const tokens = await this.signTokens(user.id, user.role);

    await this.runNotificationSafely(
      "login alert",
      {
        userId: user.id,
        email: user.email,
      },
      () =>
        notificationService.sendLoginAlert(
          user.email,
          user.username,
          ip,
          user.id,
        ),
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
    // Only accept a real email verified by the OAuth provider.
    const email = profile.email.trim();

    if (!email) {
      throw new AppError(
        HTTP_STATUS.UNAUTHORIZED,
        "A verified email address is required for social login",
      );
    }

    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingUser) {
      this.ensureAccountIsActive(existingUser.status);

      // Link the provider only after the verified email matches the account.
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
        email,
        username,
        passwordHash,
        profileImageUrl: profile.picture || undefined,
        [providerField]: true,
      })
      .returning();

    await this.runNotificationSafely(
      "OAuth welcome notification",
      {
        userId: newUser.id,
        email: newUser.email,
      },
      () =>
        notificationService.sendWelcomeEmail(
          newUser.email,
          newUser.username,
          newUser.id,
        ),
    );

    return this.signTokens(newUser.id, newUser.role);
  }

  public async refreshToken(oldRefreshToken: string) {
    let decoded: IJwtPayload;

    // 1. Verify the refresh token's signature, expiry and payload.
    try {
      const payload = jwt.verify(oldRefreshToken, env.JWT_REFRESH_SECRET, {
        algorithms: ["HS256"],
      });

      if (!isValidRefreshTokenPayload(payload)) {
        throw new Error("Invalid refresh token payload");
      }

      decoded = payload;
    } catch {
      throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Invalid Refresh Token");
    }

    // 2. Atomically consume the old refresh token.
    // This prevents the same refresh token from being reused.
    const redisKey = `refresh_token:${decoded.id}:${oldRefreshToken}`;
    const isValid = await redis.getDel(redisKey);

    if (!isValid) {
      throw new AppError(
        HTTP_STATUS.UNAUTHORIZED,
        "Session expired or invalid",
      );
    }

    // 3. Fetch the latest account status and role from the database.
    const [user] = await db
      .select({
        id: users.id,
        role: users.role,
        status: users.status,
      })
      .from(users)
      .where(eq(users.id, decoded.id))
      .limit(1);

    if (!user) {
      throw new AppError(HTTP_STATUS.UNAUTHORIZED, "User not found");
    }

    // 4. Do not issue tokens to suspended or banned accounts.
    this.ensureAccountIsActive(user.status);

    // 5. Issue a new access token and refresh token.
    return this.signTokens(user.id, user.role);
  }

  /**
   * @method logout
   * @param refreshToken
   * @returns
   */
  public async logout(refreshToken: string) {
    try {
      // Verify the refresh token before using its payload.
      const payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET, {
        algorithms: ["HS256"],
      });

      if (!isValidRefreshTokenPayload(payload)) {
        logger.warn("Logout attempted with invalid refresh token payload");
        return;
      }

      // Revoke this specific refresh-token session.
      await redis.del(`refresh_token:${payload.id}:${refreshToken}`);
    } catch (error: unknown) {
      // Logout should remain best-effort.
      // An expired or invalid token should not prevent cookie clearing.
      logger.warn("Logout attempted with invalid refresh token", {
        error,
      });
    }
  }

  /**
   * @method forgotPassword
   * @param email
   * @returns
   */
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

  /**
   * @method resetPassword
   * @param token
   * @param newPassword
   */
  public async resetPassword(token: string, newPassword: string) {
    const redisKey = `password_reset:${token}`;

    // 1. Read the token without consuming it yet.
    const userId = await redis.get(redisKey);

    if (!userId) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Invalid or expired password reset token",
      );
    }

    // 2. Verify that the associated user exists.
    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      // Remove an orphaned reset token.
      await redis.del(redisKey);

      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Invalid or expired password reset token",
      );
    }

    // 3. Hash the new password before consuming the token.
    // Keep the cost factor consistent with the rest of AuthService.
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // 4. Atomically consume the token.
    // If another request has already consumed it, this returns null.
    const consumedUserId = await redis.getDel(redisKey);

    if (!consumedUserId || consumedUserId !== userId) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Invalid or expired password reset token",
      );
    }

    // 5. Update the password.
    await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));

    // 6. Revoke all existing refresh-token sessions.
    await this.revokeAllRefreshTokens(user.id);

    try {
      await notificationService.sendPasswordUpdateEmail(
        user.email,
        user.username,
      );
    } catch (error) {
      logger.error("Failed to send password update email", {
        userId: user.id,
        error,
      });
    }
  }

  private async signTokens(userId: string, role: string) {
    const accessExpiry = ACCESS_TOKEN_EXPIRE as jwt.SignOptions["expiresIn"];
    const refreshExpiry = REFRESH_TOKEN_EXPIRE as jwt.SignOptions["expiresIn"];

    const accessToken = jwt.sign({ id: userId, role }, env.JWT_ACCESS_SECRET, {
      expiresIn: accessExpiry,
      algorithm: "HS256",
    });

    const refreshToken = jwt.sign(
      { id: userId, role },
      env.JWT_REFRESH_SECRET,
      {
        expiresIn: refreshExpiry,
        algorithm: "HS256",
      },
    );

    await redis.set(`refresh_token:${userId}:${refreshToken}`, "valid", {
      EX: REFRESH_TOKEN_EXPIRE_SEC,
    });

    return { accessToken, refreshToken };
  }

  private ensureAccountIsActive(status: User["status"]): void {
    if (status === "banned") {
      throw new AppError(HTTP_STATUS.FORBIDDEN, "Your account has been banned");
    }

    if (status === "suspended") {
      throw new AppError(
        HTTP_STATUS.FORBIDDEN,
        "Your account has been suspended",
      );
    }
  }

  public async revokeAllRefreshTokens(userId: string): Promise<void> {
    for await (const key of redis.scanIterator({
      MATCH: `refresh_token:${userId}:*`,
      COUNT: 100,
    })) {
      await redis.del(key);
    }
  }
}

export const authService = new AuthService();
