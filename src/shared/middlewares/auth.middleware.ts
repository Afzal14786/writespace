import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AppError } from "../utils/app.error";
import { HTTP_STATUS } from "../constants/http-codes";
import env from "../../config/env";

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AppError(
        HTTP_STATUS.UNAUTHORIZED,
        "No token provided, authorization denied",
      );
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, env.JWT_SECRET) as {
      id: string;
      role?: string;
      [key: string]: any;
    };

    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new AppError(HTTP_STATUS.UNAUTHORIZED, "Invalid token"));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(new AppError(HTTP_STATUS.UNAUTHORIZED, "Token expired"));
    } else {
      next(error);
    }
  }
};

/**
 * RBAC Middleware to restrict access to specific roles.
 * usage: authorize('admin')
 */
export const authorize = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.account_info || !req.user.account_info.role) {
      return next(
        new AppError(
          HTTP_STATUS.FORBIDDEN,
          "Access Forbidden: User role not defined",
        ),
      );
    }

    if (
      !allowedRoles.includes("admin") &&
      req.user.account_info.role !== "admin"
    ) {
      return next(
        new AppError(
          HTTP_STATUS.FORBIDDEN,
          "Access Forbidden: Insufficient permissions",
        ),
      );
    }

    if (
      !allowedRoles.includes("user") &&
      req.user.account_info.role !== "user"
    ) {
      return next(new AppError(HTTP_STATUS.FORBIDDEN, "Access Denies"));
    }

    next();
  };
};
