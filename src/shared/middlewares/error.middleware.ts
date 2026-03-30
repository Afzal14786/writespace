import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/app.error";
import { HTTP_STATUS } from "../constants/http-codes";
import { ZodError, ZodIssue } from "zod";
import logger from "../../config/logger"; // 🔥 FIX 1: Changed to default import

// 1. Define an interface for PostgreSQL Database Errors
interface PgError extends Error {
  code: string;
  detail?: string;
  column?: string;
}

// 2. Create a Type Guard to safely check if the error matches the PgError structure
const isPgError = (err: unknown): err is PgError => {
  return typeof err === "object" && err !== null && "code" in err;
};

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction 
): void => {
  let message = "Internal Server Error";
  
  let statusCode: number = HTTP_STATUS.INTERNAL_SERVER_ERROR;
  let stackTrace: string | undefined = undefined;

  // Safely extract standard Error properties
  if (err instanceof Error) {
    message = err.message;
    stackTrace = err.stack;
  }

  // Handle Custom Application Errors
  if (err instanceof AppError) {
    statusCode = err.statusCode;
  }

  logger.error(message, { stack: stackTrace });

  // Handle PostgreSQL Specific Errors
  if (isPgError(err)) {
    if (err.code === "23505") {
      const detail = err.detail || "";
      const match = detail.match(/\(([^)]+)\)/);
      const field = match ? match[1] : "field";
      message = `Duplicate value for ${field}`;
      statusCode = HTTP_STATUS.CONFLICT;
    } else if (err.code === "23503") {
      message = "Referenced resource not found";
      statusCode = HTTP_STATUS.BAD_REQUEST;
    } else if (err.code === "23502") {
      const column = err.column || "field";
      message = `Missing required value: ${column}`;
      statusCode = HTTP_STATUS.BAD_REQUEST;
    }
  }

  // Handle Zod Validation Errors
  if (err instanceof ZodError) {
    message = err.issues
      .map((issue: ZodIssue) => `${issue.path.join(".")}: ${issue.message}`)
      .join(", ");
    statusCode = HTTP_STATUS.BAD_REQUEST;
  }

  res.status(statusCode).json({
    success: false,
    message,
    stack: process.env.NODE_ENV === "development" ? stackTrace : undefined,
  });
};