import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { client as redisClient } from "../../config/redis";

const store = new RedisStore({
  sendCommand: (...args: string[]) => redisClient.sendCommand(args),
});

export const apiLimiter = rateLimit({
  store, 
  windowMs: 15 * 60 * 1000, 
  max: 100, 
  standardHeaders: true, 
  legacyHeaders: false, 
  message: {
    success: false,
    message: "Too many requests from this IP, please try again after 15 minutes",
  },
});

export const loginLimiter = rateLimit({
  store,
  windowMs: 15 * 60 * 1000, 
  max: 7, 
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please try again in 15 minutes.",
  },
});

export const registerLimiter = rateLimit({
  store,
  windowMs: 60 * 60 * 1000, 
  max: 3, 
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many accounts created from this IP. Please try again later.",
  },
});

export const emailActionLimiter = rateLimit({
  store,
  windowMs: 60 * 60 * 1000, 
  max: 5, 
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many email requests. Please check your inbox or try again later.",
  },
});