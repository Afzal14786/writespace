import { jest, describe, it, expect } from "@jest/globals";

// 0. MOCK ESM & IMAGE ENGINES (Prevents Jest from crashing on ES Modules like satori-html)
jest.mock("satori-html", () => ({ html: jest.fn() }));
jest.mock("satori", () => jest.fn());
jest.mock("@resvg/resvg-js", () => ({ Resvg: jest.fn() }));

import request from "supertest";
import app from "../../src/app";

// 1. MOCK REDIS (Prevents the server from hanging trying to connect to a cache)
jest.mock("../../src/config/redis", () => ({
  redisClient: {
    on: jest.fn<(...args: unknown[]) => void>(),
    connect: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    get: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    set: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  },
  connectRedis: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

// 2. MOCK BULLMQ (Prevents the server from hanging trying to connect to job queues)
jest.mock("bullmq", () => ({
  Queue: jest.fn<(...args: unknown[]) => { add: unknown }>().mockImplementation(() => ({
    add: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  })),
  Worker: jest.fn<(...args: unknown[]) => { on: unknown }>().mockImplementation(() => ({
    on: jest.fn<(...args: unknown[]) => void>(),
  })),
}));

describe("App Routing & Health Integration", () => {
  it("should return a 404 status code for completely unknown routes", async () => {
    // Act
    const res = await request(app)
      .get("/api/v1/this-route-does-not-exist")
      .set("Accept", "application/json");

    // Assert
    expect(res.status).toBe(404);
  });
});