import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AppError } from "../utils/app.error";
import { HTTP_STATUS } from "../constants/http-codes";
import { IJwtPayload } from "@modules/auth/interface/auth.interface";
import env from "@config/env";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isValidJwtPayload = (payload: unknown): payload is IJwtPayload => {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const data = payload as Record<string, unknown>;

  return (
    typeof data.id === "string" &&
    UUID_REGEX.test(data.id) &&
    (data.role === "user" || data.role === "admin")
  );
};

export const authenticate = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AppError(
        HTTP_STATUS.UNAUTHORIZED,
        "No token provided, authorization denied",
      );
    }

    const token = authHeader.slice(7).trim();

    if (!token) {
      throw new AppError(
        HTTP_STATUS.UNAUTHORIZED,
        "No token provided, authorization denied",
      );
    }

    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ["HS256"],
    });

    if (!isValidJwtPayload(decoded)) {
      throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Invalid token payload");
    }

    req.user = {
      id: decoded.id,
      role: decoded.role,
    };

    next();
  } catch (error) {
    // TokenExpiredError extends JsonWebTokenError,
    // so it must be checked first.
    if (error instanceof jwt.TokenExpiredError) {
      next(new AppError(HTTP_STATUS.UNAUTHORIZED, "Token expired"));
    } else if (error instanceof jwt.JsonWebTokenError) {
      next(new AppError(HTTP_STATUS.UNAUTHORIZED, "Invalid token"));
    } else {
      next(error);
    }
  }
};

/**
 * RBAC Middleware to restrict access to specific roles.
 *
 * Usage:
 * authorize("admin")
 * authorize("admin", "user")
 *
 * Note:
 * req.user is populated by authenticate().
 */
export const authorize = (...allowedRoles: string[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const userRole = req.user?.role;

    if (!userRole) {
      next(
        new AppError(
          HTTP_STATUS.FORBIDDEN,
          "Access Forbidden: User role not defined",
        ),
      );
      return;
    }

    if (!allowedRoles.includes(userRole)) {
      next(
        new AppError(
          HTTP_STATUS.FORBIDDEN,
          "Access Forbidden: Insufficient permissions",
        ),
      );
      return;
    }

    next();
  };
};
