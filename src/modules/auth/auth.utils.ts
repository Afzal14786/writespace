import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as GitHubStrategy } from "passport-github2";
import env from "../../config/env";
import { AppError } from "../../shared/utils/app.error";

import { randomInt } from "crypto";

export const generateOTP = (length: number = 6): string => {
  let otp = "";
  for (let i = 0; i < length; i++) {
    otp += randomInt(0, 10).toString();
  }
  return otp;
};

/**
 * Configures Passport Strategies for OAuth.
 * Note: Actual user finding/creation happens in the controller/service via the callback.
 */
export const configurePassport = () => {
  // Google Strategy
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          callbackURL: `${env.SERVER_URL}/auth/google/callback`,
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
          callbackURL: `${env.SERVER_URL}/auth/github/callback`,
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
