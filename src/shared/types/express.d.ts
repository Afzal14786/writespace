export {};

declare global {
  namespace Express {
    interface User {
      id: string;
      role?: string;
      emails?: Array<{ value: string }>;
      displayName?: string;
      photos?: Array<{ value: string }>;
      username?: string;
      [key: string]: unknown;
    }
  }
}