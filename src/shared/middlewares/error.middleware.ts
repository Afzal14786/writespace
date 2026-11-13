import { Request, Response, NextFunction } from "express";

import { ZodError } from "zod";

import { AppError } from "../utils/app.error";
import { HTTP_STATUS } from "../constants/http-codes";

import logger from "@config/logger";
import env from "@config/env";

interface PgError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
  column?: string;
}

const isPgError = (error: unknown): error is PgError => {
  return typeof error === "object" && error !== null && "code" in error;
};

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (res.headersSent) {
    _next(err);
    return;
  }

  let statusCode: number = HTTP_STATUS.INTERNAL_SERVER_ERROR;

  let message = "Internal Server Error";

  let isOperational = false;

  // Application errors

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    isOperational = err.isOperational;
  }

  // Zod validation errors
  else if (err instanceof ZodError) {
    statusCode = HTTP_STATUS.BAD_REQUEST;
    message = "Validation failed";
  }

  // PostgreSQL errors
  else if (isPgError(err)) {
    switch (err.code) {
      case "23505":
        statusCode = HTTP_STATUS.CONFLICT;
        message = "Resource already exists";
        break;

      case "23503":
        statusCode = HTTP_STATUS.BAD_REQUEST;
        message = "Referenced resource does not exist";
        break;

      case "23502":
        statusCode = HTTP_STATUS.BAD_REQUEST;
        message = "Required field is missing";
        break;

      case "22P02":
        statusCode = HTTP_STATUS.BAD_REQUEST;
        message = "Invalid data format";
        break;

      default:
        statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR;

        message = "Database operation failed";
    }
  }

  // --------------------------------------------------
  else if (err instanceof Error) {
    message = "Internal Server Error";
  }

  // Logging

  const errorForLogging = err instanceof Error ? err : new Error(String(err));

  logger.error(
    `[${req.method}] ${req.originalUrl} - ${statusCode} - ${message}`,
    {
      error: errorForLogging,
      stack: errorForLogging.stack,
      operational: isOperational,
    },
  );

  // Response

  const response: {
    success: false;
    message: string;
    errors?: unknown;
    stack?: string;
  } = {
    success: false,
    message,
  };

  // Preserve structured Zod errors
  if (err instanceof ZodError) {
    response.errors = err.flatten();
  }

  // Stack should ONLY be returned in development
  if (env.NODE_ENV === "development" && errorForLogging.stack) {
    response.stack = errorForLogging.stack;
  }

  res.status(statusCode).json(response);
};
