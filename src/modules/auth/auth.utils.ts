import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as GitHubStrategy } from "passport-github2";
import env from "../../config/env";
import { AppError } from "../../shared/utils/app.error";

/**
 * Generates a numeric OTP of specified length.
 */
export const generateOTP = (length: number = 6): string => {
  const digits = "0123456789";
  let otp = "";
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * 10)];
  }
  return otp;
};

/**
 * Configures Passport Strategies for OAuth.
 * Note: Actual user finding/creation happens in the controller/service via the callback.
 */
export const configurePassport = () => {
  // Serialization
  passport.serializeUser((user: any, done) => {
    done(null, user);
  });

  passport.deserializeUser((user: any, done) => {
    done(null, user);
  });

  // Google Strategy
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          callbackURL: `${env.CLIENT_URL}/api/auth/google/callback`,
        },
        (accessToken, refreshToken, profile, done) => {
          // Pass profile to controller/service
          return done(null, profile);
        },
      ),
    );
  }

  // GitHub Strategy
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    passport.use(
      new GitHubStrategy(
        {
          clientID: env.GITHUB_CLIENT_ID,
          clientSecret: env.GITHUB_CLIENT_SECRET,
          callbackURL: `${env.CLIENT_URL}/api/auth/github/callback`,
          scope: ["user:email"],
        },
        (
          accessToken: string,
          refreshToken: string,
          profile: any,
          done: any,
        ) => {
          return done(null, profile);
        },
      ),
    );
  }
};
