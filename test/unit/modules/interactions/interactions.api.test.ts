import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import env from "../../../../src/config/env";

// 1. MOCK ESM & IMAGE ENGINES
jest.mock("satori-html", () => ({ html: jest.fn() }));
jest.mock("satori", () => jest.fn());
jest.mock("@resvg/resvg-js", () => ({ Resvg: jest.fn() }));

// 2. MOCK DB
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

// 6. MOCK INTERACTIONS SERVICE
jest.mock("../../../../src/modules/interactions/interactions.service", () => ({
  interactionsService: {
    createComment: jest.fn<() => Promise<any>>(),
    deleteComment: jest.fn<() => Promise<void>>(),
    toggleLikePost: jest.fn<() => Promise<any>>(),
    toggleLikeComment: jest.fn<() => Promise<any>>(),
    logShare: jest.fn<() => Promise<void>>(),
  },
}));

import app from "../../../../src/app";
import { interactionsService } from "../../../../src/modules/interactions/interactions.service";

const VALID_TOKEN = jwt.sign({ id: "user-123", role: "user" }, env.JWT_ACCESS_SECRET);

describe("Interactions API Integration Tests", () => {
  const MOCK_POST_ID = "post-123";
  const MOCK_COMMENT_ID = "comment-123";
  const BASE_PATH = "/api/v1/interactions";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /posts/:postId/like", () => {
    it("should return 200 OK and the like status on success", async () => {
      (interactionsService.toggleLikePost as jest.Mock).mockResolvedValueOnce({ status: "liked" } as never);

      const res = await request(app)
        .post(`${BASE_PATH}/posts/${MOCK_POST_ID}/like`)
        .set("Authorization", `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("liked");
    });
  });

  describe("POST /comments/:postId", () => {
    it("should return 400 Bad Request if comment content is empty", async () => {
      const res = await request(app)
        .post(`${BASE_PATH}/comments/${MOCK_POST_ID}`)
        .set("Authorization", `Bearer ${VALID_TOKEN}`)
        .send({ content: "" }); 

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Validation Error");
    });

    it("should return 201 Created when adding a valid comment", async () => {
      const mockComment = { id: MOCK_COMMENT_ID, content: "Great post!" };
      (interactionsService.createComment as jest.Mock).mockResolvedValueOnce(mockComment as never);

      const res = await request(app)
        .post(`${BASE_PATH}/comments/${MOCK_POST_ID}`)
        .set("Authorization", `Bearer ${VALID_TOKEN}`)
        .send({ content: "Great post!" });

      expect(res.status).toBe(201);
      expect(res.body.data).toEqual(mockComment);
    });
  });

  describe("DELETE /comments/:commentId", () => {
    it("should return 200 OK when deleting an owned comment", async () => {
      (interactionsService.deleteComment as jest.Mock).mockResolvedValueOnce(undefined as never);

      const res = await request(app)
        .delete(`${BASE_PATH}/comments/${MOCK_COMMENT_ID}`)
        .set("Authorization", `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(interactionsService.deleteComment).toHaveBeenCalledWith("user-123", MOCK_COMMENT_ID, false);
    });
  });
});