import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { client as redisClient } from "../../config/redis";

const store = new RedisStore({
  sendCommand: (...args: string[]) => redisClient.sendCommand(args),
});

export const apiLimiter = rateLimit({
  store, // SCALABILITY FIX: Use Redis
  windowMs: 15 * 60 * 1000, 
  max: 100, 
  standardHeaders: true, 
  legacyHeaders: false, 
  message: {
    success: false,
    message: "Too many requests from this IP, please try again after 15 minutes",
  },
});

export const authLimiter = rateLimit({
  store, // SCALABILITY FIX: Use Redis
  windowMs: 60 * 60 * 1000, 
  max: 20, // INCREASED slightly: 10 is too strict if multiple legit users share an office/college WiFi (NAT IP)
  message: {
    success: false,
    message: "Too many login attempts, please try again after an hour",
  },
});
