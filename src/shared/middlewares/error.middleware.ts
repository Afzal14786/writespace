import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/app.error";
import { HTTP_STATUS } from "../constants/http-codes";
import { ZodError } from "zod";
import logger from "../../config/logger";

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  let message = err.message || "Server Error";
  let statusCode = err.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;

  logger.error(message, { stack: err.stack });

  if (err.code === "23505") {
    const detail = err.detail || "";
    const match = detail.match(/\(([^)]+)\)/);
    const field = match ? match[1] : "field";
    message = `Duplicate value for ${field}`;
    statusCode = HTTP_STATUS.CONFLICT;
  }

  if (err.code === "23503") {
    message = "Referenced resource not found";
    statusCode = HTTP_STATUS.BAD_REQUEST;
  }

  if (err.code === "23502") {
    const column = err.column || "field";
    message = `Missing required value: ${column}`;
    statusCode = HTTP_STATUS.BAD_REQUEST;
  }

  if (err instanceof ZodError) {
    message = err.issues
      .map((e: any) => `${e.path.join(".")}: ${e.message}`)
      .join(", ");
    statusCode = HTTP_STATUS.BAD_REQUEST;
  }

  res.status(statusCode).json({
    success: false,
    message,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
};
