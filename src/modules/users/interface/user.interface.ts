import { User } from "../../../db/schema";

export type { User };

export type PublicUser = Omit<
  User,
  "passwordHash" | "loginAttempts" | "lockUntil"
>;
