import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";

// 1. MOCK ESM & IMAGE ENGINES 
jest.mock("satori-html", () => ({ html: jest.fn() }));
jest.mock("satori", () => jest.fn());
jest.mock("@resvg/resvg-js", () => ({ Resvg: jest.fn() }));

// 2. MOCK DB TO PREVENT HANGING ON `pool.query("SELECT 1")` in app.ts
jest.mock("../../../../src/db", () => ({
  pool: {
    query: jest.fn<() => Promise<{ rowCount: number }>>().mockResolvedValue({ rowCount: 1 }),
    end: jest.fn(),
  },
  db: {} // DB queries won't be hit because we mock authService below
}));

// 3. MOCK RATE LIMITERS
jest.mock("../../../../src/shared/middlewares/rate-limit.middleware", () => ({
  apiLimiter: (req: Request, res: Response, next: NextFunction) => next(),
  loginLimiter: (req: Request, res: Response, next: NextFunction) => next(),
  registerLimiter: (req: Request, res: Response, next: NextFunction) => next(),
  emailActionLimiter: (req: Request, res: Response, next: NextFunction) => next(),
}));

// 4. MOCK REDIS & BULLMQ
jest.mock("../../../../src/config/redis", () => ({
  client: {
    on: jest.fn(),
    connect: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    get: jest.fn(),
    set: jest.fn(),
    sendCommand: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
  },
  connectRedis: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  })),
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
  })),
}));

// 5. MOCK LOGGER
jest.mock("../../../../src/config/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));

// 6. MOCK AUTH SERVICE
jest.mock("../../../../src/modules/auth/auth.service", () => ({
  authService: {
    initiateRegistration: jest.fn(),
    verifyRegistration: jest.fn(),
    login: jest.fn(),
    refreshToken: jest.fn(),
    logout: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    updatePassword: jest.fn(),
    googleAuth: jest.fn(),
    githubAuth: jest.fn(),
  },
}));

// Import App AFTER all mocks are established
import app from "../../../../src/app";
import { authService } from "../../../../src/modules/auth/auth.service";

describe("Auth API Integration Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /api/v1/auth/register", () => {
    it("should return 400 Bad Request if validation fails (Zod)", async () => {
      const res = await request(app)
        .post("/api/v1/auth/register")
        .send({
          fullname: "John Doe",
          username: "johndoe",
          email: "invalid-email", 
          password: "short"       
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Validation Error");
      expect(res.body.message).toContain("Invalid email address");
    });

    it("should return 200 OK and initiate registration for valid payload", async () => {
      (authService.initiateRegistration as jest.Mock).mockResolvedValueOnce({
        message: "OTP sent to email."
      } as never);

      const res = await request(app)
        .post("/api/v1/auth/register")
        .send({
          fullname: "John Doe",
          username: "johndoe",
          email: "john@example.com",
          password: "ValidPassword123!" 
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("OTP sent to email.");
    });
  });

  describe("POST /api/v1/auth/login", () => {
    it("should return 200 OK and attach HttpOnly cookie on success", async () => {
      const mockUser = { id: "123", username: "testuser", email: "test@example.com", role: "user" };
      (authService.login as jest.Mock).mockResolvedValueOnce({
        user: mockUser,
        accessToken: "mock_access_token",
        refreshToken: "mock_refresh_token"
      } as never);

      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "test@example.com", password: "ValidPassword123!" });

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBe("mock_access_token");
      
      const setCookieHeader = res.headers["set-cookie"];
      expect(setCookieHeader).toBeDefined();
      
      // Safely normalize header to array
      const cookiesArray = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
      
      const refreshTokenCookie = cookiesArray.find((c: string | undefined) => 
        typeof c === 'string' && c.startsWith("refreshToken=")
      );
      
      expect(refreshTokenCookie).toBeDefined();
      expect(refreshTokenCookie).toContain("HttpOnly");
      expect(refreshTokenCookie).toContain("mock_refresh_token");
    });
  });

  describe("Protected Routes Security", () => {
    it("should return 401 Unauthorized when accessing a protected route without a token", async () => {
      const res = await request(app)
        .put("/api/v1/auth/update-password")
        .send({ currentPassword: "OldPassword1!", newPassword: "NewPassword1!" });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain("No token provided");
    });

    it("should return 401 Unauthorized when accessing a protected route with a fake token", async () => {
      const res = await request(app)
        .put("/api/v1/auth/update-password")
        .set("Authorization", "Bearer fake_and_invalid_jwt_token")
        .send({ currentPassword: "OldPassword1!", newPassword: "NewPassword1!" });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain("Invalid token");
    });
  });
});