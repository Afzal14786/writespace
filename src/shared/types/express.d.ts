import { IUser } from "../../modules/users/interface/user.interface";

declare global {
  namespace Express {
    interface Request {
      user?: Partial<IUser> & { id: string };
    }
  }
}

// Ensure this file is treated as a module
export {};
