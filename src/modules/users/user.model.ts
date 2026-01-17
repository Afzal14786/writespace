import mongoose, { Schema, HydratedDocument } from "mongoose";
import bcrypt from "bcryptjs";
import { IUser, IUserModel } from "./interface/user.interface";

/**
 * @file users.model.ts
 * @description Mongoose Schema definition for the User entity.
 * Implements the IUser interface and handles database-level logic like
 * password hashing and method attachment.
 */

const userSchema = new Schema<IUser, IUserModel>(
  {
    // === 1. Personal Information ===
    personal_info: {
      fullname: {
        type: String,
        required: true,
        minlength: 3,
        lowercase: true,
      },
      email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        match: [
          /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
          "Invalid email format",
        ],
      },
      /** @security Stored as BCrypt hash. Never selected by default. */
      password: {
        type: String,
        required: true,
        select: false,
      },
      username: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        index: true,
      },
      bio: {
        type: String,
        maxlength: 200,
        default: "",
      },
      profile_image: {
        url: {
          type: String,
          default: "https://api.dicebear.com/7.x/adventurer/svg?seed=mail",
        },
        public_id: {
          type: String,
          default: "",
        },
      },
      banner_image: {
        url: {
          type: String,
          default: "",
        },
        public_id: {
          type: String,
          default: "",
        },
      },
    },

    // === 2. Social Links ===
    social_links: {
      youtube: {
        type: String,
        default: "",
      },
      instagram: {
        type: String,
        default: "",
      },
      facebook: {
        type: String,
        default: "",
      },
      twitter: {
        type: String,
        default: "",
      },
      github: {
        type: String,
        default: "",
      },
      website: {
        type: String,
        default: "",
      },
      linkedin: {
        type: String,
        default: "",
      },
    },

    // === 3. Account Status & Security ===
    account_info: {
      total_posts: {
        type: Number,
        default: 0,
      },
      total_reads: {
        type: Number,
        default: 0,
      },
      total_followers: {
        type: Number,
        default: 0,
      },
      total_following: {
        type: Number,
        default: 0,
      },
      status: {
        type: String,
        enum: ["active", "suspended", "banned"],
        default: "active",
      },
      role: {
        type: String,
        enum: ["user", "admin"],
        default: "user",
      },
      loginAttempts: {
        type: Number,
        default: 0,
        select: false,
      },
      lockUntil: {
        type: Number,
        select: false,
      },
    },
    // === 4. Auth Providers ===
    google_auth: {
      type: Boolean,
      default: false,
    },
    github_auth: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

// === INSTANCE METHODS ===

/**
 * Verifies if the provided plain-text password matches the stored hash.
 * @param {string} candidatePassword - The raw password input by the user.
 * @returns {Promise<boolean>} True if passwords match, false otherwise.
 */
userSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  if (!this.personal_info.password) {
    return false;
  }
  return bcrypt.compare(candidatePassword, this.personal_info.password);
};

/**
 * Returns a sanitized user object safe for API responses.
 * Removes sensitive fields like password, login attempts, and internal flags.
 * @returns {Partial<IUser>} The clean user object.
 */

userSchema.methods.getPublicProfile = function () {
  const user = this.toObject();
  delete user.personal_info.password;
  delete user.personal_info.loginAttempts;
  delete user.personal_info.lockUntil;
  return user;
};

// === MIDDLEWARE (HOOKS) ===

/**
 * Pre-save hook to automatically hash the password before storing.
 * Only runs if the password field has been modified (new user or password reset).
 */

userSchema.pre("save", async function (this: HydratedDocument<IUser>) {
  if (!this.isModified("personal_info.password")) {
    return;
  }
  if (this.personal_info.password) {
    this.personal_info.password = await bcrypt.hash(
      this.personal_info.password,
      10,
    );
  }
});

export const User = mongoose.model<IUser, IUserModel>("User", userSchema);
