import { Document, Model } from "mongoose";

/**
 * @file user.interface.ts
 * @description Definations of the User entity, including personal details, social links, and
 * account status. This serves as the contract for the User Model .
 */

/**
 * Represents the core personal identity information of a user.
 * These fields are primarily used for authentication and profile display.
 */
export interface IPersonalInfo {
  /** * The user's full display name
   * @minLength 3
   */
  fullname: string;

  /** * Unique email address is used for authentication and notification
   * Must be validated with Regex before saving
   */
  email: string;

  /** * Bcrypt hash of the user's password
   * @optional Because users logging in via Google/Github won't have a password.
   * @security STRICTLY PRIVATE - never return this in API responses.
   */
  password?: string;

  /** * Unique handle for he user (e.g., @iamafzal.dev).
   * Used for generating profile URLs.
   */
  username: string;

  /** * Short biography or description displayed on the public profile.
   * @maxLength 200
   */
  bio?: string;

  /** * The user's avatar image.
   * Store both URL & Cloudinary Public ID for easier management/deletion.
   */
  profile_image?: {
    url: string;
    public_id: string;
  };

  /** * Large header image displayed on the user's profile page.
   */
  banner_image?: {
    url: string;
    public_id: string;
  };
}

/**
 * Optional social media profile links.
 * Used to generate the "Connect" section on the profile.
 */
export interface ISocialMediaLinks {
  youtube?: string;
  instagram?: string;
  facebook?: string;
  twitter?: string;
  github?: string;
  website?: string;
  linkedin?: string;
}

/**
 * System-managed account statistics and security flags.
 * The user usually cannot edit these fields directly.
 */
export interface IAccountInfo {
  /** Total number of blog posts published by the user. */
  total_posts: number;

  /** Cumulative view count across all user's posts. */
  total_reads: number;

  /** Count of other users following this account */
  total_followers: number;

  /** Count of users this account following */
  total_following: number;

  /** The current standing of the account
   * - `active`: Normal access.
   * - `suspended`: Temporary restriction.
   * - `banned`: Permanent removal.
   */
  status: "active" | "suspended" | "banned";

  /** * Access control level
   * @default 'user'
   */
  role: "user" | "admin";

  /** * Tracks failed login attempts to prevent brute-force attacks.
   * Resets on successful login.
   */
  loginAttempts: number;

  /** * Timestamp (Epoch) until which the account is locked.
   * If `undefined` or in the past, the account is unlocked.
   */
  lockUntil: number;
  isVarified: boolean;
}

/**
 * The main User Document interface extending Mongoose's Document.
 * This combines all sub-interfaces into the final database shape.
 */
export interface IUser extends Document {
  // === Data Sections ===
  personal_info: IPersonalInfo;
  social_links: ISocialMediaLinks;
  account_info: IAccountInfo;

  // === Auth Flags ===
  /** True if the user registered via Google OAuth */
  google_auth: boolean;
  /** True if the user registered via GitHub OAuth */
  github_auth: boolean;

  // === Timestamps (Managed by Mongoose) ===
  createdAt: Date;
  updatedAt: Date;

  // === Instance Methods (Behaviors) ===

  /**
   * Verifies a plain-text password against the stored Bcrypt hash.
   * @param candidatePassword - The plain text password input by user.
   * @returns Promise resolving to true if match, false otherwise.
   */
  comparePassword(candidatePassword: string): Promise<boolean>;

  /**
   * Increments failed login attempts.
   * If attempts exceed the limit (e.g., 5), sets `lockUntil` timestamp.
   */
  incrementLoginAttempt(): Promise<void>;

  /**
   * Generates a safe-to-send version of the user profile.
   * Removes sensitive data like password, email, and security flags.
   * @returns A partial user object ready for API response.
   */
  getPublicProfile(): Partial<IUser>;
}

/**
 * Static methods available on the User Model itself.
 */
export interface IUserModel extends Model<IUser> {
  /**
   * custom finder to locate a user by email.
   * @param email - The email address to search for.
   */
  findByEmail(email: string): Promise<IUser | null>;
}
