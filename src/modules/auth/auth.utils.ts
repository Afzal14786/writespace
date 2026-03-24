import passport from "passport";
import { Strategy as GoogleStrategy, Profile as GoogleProfile } from "passport-google-oauth20";
import { Strategy as GitHubStrategy, Profile as GitHubProfile } from "passport-github2";
import env from "../../config/env";
import { randomInt } from "crypto";

export const generateOTP = (length: number = 6): string => {
  let otp = "";
  for (let i = 0; i < length; i++) {
    otp += randomInt(0, 10).toString();
  }
  return otp;
};


type PassportDoneCallback = (error: Error | null, user?: Express.User | false) => void;

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
        (
          _accessToken: string, 
          _refreshToken: string, 
          profile: GoogleProfile, 
          done: PassportDoneCallback
        ) => {
          // Pass profile to controller/service
          return done(null, profile as unknown as Express.User);
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
          _accessToken: string, 
          _refreshToken: string, 
          profile: GitHubProfile, 
          done: PassportDoneCallback
        ) => {
          return done(null, profile as unknown as Express.User);
        },
      ),
    );
  }
};