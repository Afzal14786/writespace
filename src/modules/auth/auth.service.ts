import jwt from "jsonwebtoken";
import { User } from "../users/user.model";
import { client as redis } from "../../config/redis";
import env from "../../config/env";
import { AppError } from "../../shared/utils/app.error";
import { HTTP_STATUS } from "../../shared/constants/http-codes";
import { notificationService } from "../notification/notification.service";
import { RegisterInput } from "./dtos/register.dto";
import { LoginInput } from "./dtos/login.dto";
import { generateOTP } from "./auth.utils";
import { IOAuthProfile } from "./interface/auth.interface";

// Token Expiry Config
const ACCESS_TOKEN_EXPIRE = "15m";
const REFRESH_TOKEN_EXPIRE = "7d";
const REFRESH_TOKEN_EXPIRE_SEC = 7 * 24 * 60 * 60; // 7 Days in seconds
const OTP_EXPIRE_SEC = 600; // 10 Minutes

class AuthService {
  /**
   * Step 1: Initiate Registration
   * Validates input, generates OTP, stores in Redis, sends Email.
   */
  public async initiateRegistration(data: RegisterInput) {
    // 1. Check if user exists
    const existingUser = await User.findOne({
      $or: [
        { "personal_info.email": data.email },
        { "personal_info.username": data.username },
      ],
    });

    if (existingUser) {
      throw new AppError(
        HTTP_STATUS.CONFLICT,
        "Email or Username already exists",
      );
    }

    // 2. Generate OTP
    const otp = generateOTP(6);

    // 3. Cache Registration Data (TTL 10 mins)
    // We store the hashed password (pre-save hook won't run on raw object, so we depend on Model creation later)
    // Actually, it's safer to store raw data and let the model handle hashing upon creation
    const registrationData = { ...data, otp };
    await redis.set(
      `auth:register:${data.email}`,
      JSON.stringify(registrationData),
      {
        EX: OTP_EXPIRE_SEC,
      },
    );

    // 4. Send OTP Email
    await notificationService.sendOtpEmail(data.email, otp);

    return {
      message: "OTP sent to email. Please verify to complete registration.",
    };
  }

  /**
   * Step 2: Verify OTP & Create User
   */
  public async verifyRegistration(email: string, otp: string) {
    // 1. Retrieve Cached Data
    const cachedData = await redis.get(`auth:register:${email}`);
    if (!cachedData) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "OTP expired or invalid");
    }

    const data = JSON.parse(cachedData);

    // 2. Verify OTP Match
    if (data.otp !== otp) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid OTP");
    }

    // 3. Create User (Model hook will hash password)
    const user = await User.create({
      personal_info: {
        fullname: data.fullname,
        email: data.email,
        username: data.username,
        password: data.password,
      },
    });

    // 4. Clear Cache
    await redis.del(`auth:register:${email}`);

    // 5. Generate Tokens
    const tokens = await this.signTokens(user.id);

    // 6. Send Welcome Email
    await notificationService.sendWelcomeEmail(
      user.personal_info.email,
      user.personal_info.username,
      user.id,
    );

    return { user: user.getPublicProfile(), ...tokens };
  }

  /**
   * Authenticates a user and issues tokens.
   */
  public async login(data: LoginInput, ip: string) {
    // 1. Find User
    const user = await User.findOne({
      "personal_info.email": data.email,
    }).select("+personal_info.password");

    if (!user || !(await user.comparePassword(data.password))) {
      throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Invalid email or password");
    }

    // 2. Generate Tokens
    const tokens = await this.signTokens(user.id);

    // 3. Send Security Alert
    await notificationService.sendLoginAlert(
      user.personal_info.email,
      user.personal_info.username,
      ip,
      user.id,
    );

    return { user: user.getPublicProfile(), ...tokens };
  }

  /**
   * Handles OAuth Login/Register (Google/GitHub).
   */
  public async googleAuth(profile: IOAuthProfile) {
    return this.handleSocialAuth(profile, "google_auth");
  }

  public async githubAuth(profile: IOAuthProfile) {
    return this.handleSocialAuth(profile, "github_auth");
  }

  private async handleSocialAuth(
    profile: IOAuthProfile,
    providerField: "google_auth" | "github_auth",
  ) {
    // 1. Check if user exists by email
    let user = await User.findOne({ "personal_info.email": profile.email });

    if (user) {
      // Link account if not linked
      if (!user[providerField]) {
        user[providerField] = true;
        await user.save();
      }
    } else {
      // Create new user with random password
      const username =
        profile.displayName.toLowerCase().replace(/\s+/g, "") + generateOTP(4);
      const randomPassword = generateOTP(16) + "Aa1!"; // Strong random password

      user = await User.create({
        personal_info: {
          fullname: profile.displayName,
          email: profile.email,
          username,
          password: randomPassword,
          profile_image: { url: profile.picture || "" },
        },
        [providerField]: true,
        account_info: { isVarified: true }, // Trust social provider
      });

      // 6. Send Welcome Email
      await notificationService.sendWelcomeEmail(
        user.personal_info.email,
        user.personal_info.username,
        user.id,
      );
    }

    return this.signTokens(user.id);
  }

  /**
   * Refreshes the Access Token using a valid Refresh Token.
   */
  public async refreshToken(refreshToken: string) {
    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, env.JWT_SECRET);
    } catch (err) {
      throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Invalid Refresh Token");
    }

    const storedToken = await redis.get(`refresh_token:${decoded.id}`);
    if (!storedToken || storedToken !== refreshToken) {
      throw new AppError(
        HTTP_STATUS.UNAUTHORIZED,
        "Session expired or invalid",
      );
    }

    const accessToken = jwt.sign(
      { id: decoded.id, role: decoded.role },
      env.JWT_SECRET,
      {
        expiresIn: ACCESS_TOKEN_EXPIRE,
      },
    );

    return { accessToken };
  }

  /**
   * Logs out the user.
   */
  public async logout(userId: string) {
    await redis.del(`refresh_token:${userId}`);
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private async signTokens(userId: string) {
    const accessToken = jwt.sign({ id: userId, role: "user" }, env.JWT_SECRET, {
      expiresIn: ACCESS_TOKEN_EXPIRE,
    });

    const refreshToken = jwt.sign(
      { id: userId, role: "user" },
      env.JWT_SECRET,
      {
        expiresIn: REFRESH_TOKEN_EXPIRE,
      },
    );

    await redis.set(`refresh_token:${userId}`, refreshToken, {
      EX: REFRESH_TOKEN_EXPIRE_SEC,
    });

    return { accessToken, refreshToken };
  }
}

export const authService = new AuthService();
