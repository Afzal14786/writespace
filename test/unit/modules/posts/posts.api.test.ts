import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import env from "../../../../src/config/env";

// 1. MOCK ESM & IMAGE ENGINES 
jest.mock("satori-html", () => ({ html: jest.fn() }));
jest.mock("satori", () => jest.fn());
jest.mock("@resvg/resvg-js", () => ({ Resvg: jest.fn() }));

// 2. MOCK DB (Prevents hanging on pool.query("SELECT 1"))
jest.mock("../../../../src/db", () => ({
  pool: {
    query: jest.fn<() => Promise<{ rowCount: number }>>().mockResolvedValue({ rowCount: 1 }),
    end: jest.fn(),
  },
  db: {} 
}));

// 3. MOCK RATE LIMITERS
jest.mock("../../../../src/shared/middlewares/rate-limit.middleware", () => ({
  apiLimiter: (req: Request, res: Response, next: NextFunction) => next(),
  loginLimiter: (req: Request, res: Response, next: NextFunction) => next(),
  registerLimiter: (req: Request, res: Response, next: NextFunction) => next(),
  emailActionLimiter: (req: Request, res: Response, next: NextFunction) => next(),
}));

// 4. MOCK UPLOAD MIDDLEWARE
jest.mock("../../../../src/shared/middlewares/upload.middleware", () => ({
  upload: {
    fields: () => (req: Request, res: Response, next: NextFunction) => next(),
    single: () => (req: Request, res: Response, next: NextFunction) => next(),
    array: () => (req: Request, res: Response, next: NextFunction) => next(),
  }
}));

// 5. MOCK REDIS & BULLMQ
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

// 6. MOCK LOGGER
jest.mock("../../../../src/config/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));

// 7. MOCK POST SERVICE
jest.mock("../../../../src/modules/posts/posts.service", () => ({
  postService: {
    createPost: jest.fn<() => Promise<any>>(),
    getPosts: jest.fn<() => Promise<any>>(),
    getPost: jest.fn<() => Promise<any>>(),
    updatePost: jest.fn<() => Promise<any>>(),
    deletePost: jest.fn<() => Promise<void>>(),
    likePost: jest.fn<() => Promise<any>>(),
    sharePost: jest.fn<() => Promise<any>>(),
  },
}));

// Import App AFTER all mocks are established
import app from "../../../../src/app";
import { postService } from "../../../../src/modules/posts/posts.service";

// GENERATE A REAL, VALID TOKEN FOR PROTECTED ROUTES
const VALID_TOKEN = jwt.sign({ id: "user-123", role: "user" }, env.JWT_ACCESS_SECRET);

describe("Posts API Integration Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /api/v1/posts", () => {
    it("should return 401 Unauthorized if no token is provided", async () => {
      // Act
      const res = await request(app)
        .post("/api/v1/posts")
        .send({ title: "My Post", content: "Some content" });
        
      // Assert
      expect(res.status).toBe(401);
      expect(res.body.message).toContain("No token provided");
    });

    it("should return 400 Bad Request if validation fails (Zod)", async () => {
      // Act
      const res = await request(app)
        .post("/api/v1/posts")
        .set("Authorization", `Bearer ${VALID_TOKEN}`)
        .send({
          title: "A", // Fails Zod .min(5)
          content: "Content"
        });

      // Assert
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Validation Error");
      expect(res.body.message).toContain("Title must be at least 5 characters long");
    });

    it("should return 201 Created and properly format a valid payload", async () => {
      // Arrange
      const mockCreatedPost = { id: "post-123", title: "Valid Title", content: "Valid Content" };
      (postService.createPost as jest.Mock).mockResolvedValueOnce(mockCreatedPost as never);

      // Act
      const res = await request(app)
        .post("/api/v1/posts")
        .set("Authorization", `Bearer ${VALID_TOKEN}`)
        .send({
          title: "Valid Title",
          content: "Valid Content",
          isPublished: true
        });

      // Assert
      expect(res.status).toBe(201);
      expect(res.body.data).toEqual(mockCreatedPost);
      expect(postService.createPost).toHaveBeenCalledTimes(1);
    });
  });

  describe("GET /api/v1/posts", () => {
    it("should return 200 OK and a paginated list of posts", async () => {
      // Arrange
      const mockPostsResponse = {
        posts: [{ id: "post-1", title: "Post 1" }],
        nextCursor: null
      };
      (postService.getPosts as jest.Mock).mockResolvedValueOnce(mockPostsResponse as never);

      // Act
      const res = await request(app)
        .get("/api/v1/posts")
        .set("Authorization", `Bearer ${VALID_TOKEN}`); // Even though it's public, testing auth passthrough

      // Assert
      expect(res.status).toBe(200);
      expect(res.body.data.posts).toHaveLength(1);
      expect(postService.getPosts).toHaveBeenCalledTimes(1);
    });
  });
});