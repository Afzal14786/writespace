import { PublicUser } from "../../modules/users/interface/user.interface";

declare global {
  namespace Express {
    interface Request {
      /**
       * The authenticated user object attached by the authenticate middleware.
       * Uses PublicUser to ensure sensitive fields like passwordHash are excluded.
       */
      user?: PublicUser;
    }
  }
}

// Export empty object to ensure the file is treated as a module 
// and the augmentation takes effect.
export {};