import { Request, Response, NextFunction, RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { client } from "../../config/redis";
import { HTTP_STATUS } from "../constants/http-codes";

// 1. FACTORY PATTERN: Generate a unique store for each limiter to fix ERR_ERL_STORE_REUSE
const createStore = (prefix: string) => {
  return new RedisStore({
    sendCommand: (...args: string[]) => client.sendCommand(args),
    prefix: prefix,
  });
};

// 2. LAZY INITIALIZATION: We wrap the limiters in a function so they don't 
// try to ping Redis until the first request actually hits the server, fixing ClientClosedError.

let _apiLimiter: RequestHandler;
export const apiLimiter = (req: Request, res: Response, next: NextFunction) => {
  if (!_apiLimiter) {
    _apiLimiter = rateLimit({
      store: createStore("rl:api:"),
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // Limit each IP to 100 requests per 15 mins
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
          success: false,
          message: "Too many requests from this IP, please try again after 15 minutes",
          data: null
        });
      }
    });
  }
  return _apiLimiter(req, res, next);
};

let _loginLimiter: RequestHandler;
export const loginLimiter = (req: Request, res: Response, next: NextFunction) => {
  if (!_loginLimiter) {
    _loginLimiter = rateLimit({
      store: createStore("rl:login:"),
      windowMs: 15 * 60 * 1000, 
      max: 8, // Strict limit for brute-force protection
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
          success: false,
          message: "Too many login attempts. Please try again in 15 minutes",
          data: null
        });
      }
    });
  }
  return _loginLimiter(req, res, next);
};

let _registerLimiter: RequestHandler;
export const registerLimiter = (req: Request, res: Response, next: NextFunction) => {
  if (!_registerLimiter) {
    _registerLimiter = rateLimit({
      store: createStore("rl:register:"),
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 5, // Prevent bot farming
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
          success: false,
          message: "Too many accounts created from this IP. Please try again after an hour",
          data: null
        });
      }
    });
  }
  return _registerLimiter(req, res, next);
};

let _emailActionLimiter: RequestHandler;
export const emailActionLimiter = (req: Request, res: Response, next: NextFunction) => {
  if (!_emailActionLimiter) {
    _emailActionLimiter = rateLimit({
      store: createStore("rl:email:"),
      windowMs: 60 * 60 * 1000, 
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
          success: false,
          message: "Too many email actions requested. Please try again after an hour",
          data: null
        });
      }
    });
  }
  return _emailActionLimiter(req, res, next);
};