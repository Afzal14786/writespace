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

    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as {
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
 * usage: authorize('admin') or authorize('admin', 'user')
 *
 * Note: req.user is set from the decoded JWT in `authenticate`,
 * which contains { id, role } at the top level.
 */
export const authorize = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const userRole = req.user?.role;

    if (!userRole) {
      return next(
        new AppError(
          HTTP_STATUS.FORBIDDEN,
          "Access Forbidden: User role not defined",
        ),
      );
    }

    if (!allowedRoles.includes(userRole)) {
      return next(
        new AppError(
          HTTP_STATUS.FORBIDDEN,
          "Access Forbidden: Insufficient permissions",
        ),
      );
    }

    next();
  };
};
