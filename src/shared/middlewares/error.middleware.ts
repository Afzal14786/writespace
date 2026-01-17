import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/app.error";
import { HTTP_STATUS } from "../constants/http-codes";
import { ZodError } from "zod"; // Assuming Zod is used

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  let error = err;

  // Default message and status
  let message = err.message || "Server Error";
  let statusCode = err.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;

  // Log error for debugging
  console.error(err);

  // Mongoose Bad ObjectId
  if (err.name === "CastError") {
    message = `Resource not found. Invalid: ${err.path}`;
    statusCode = HTTP_STATUS.NOT_FOUND;
    error = new AppError(statusCode, message);
  }

  // Mongoose Duplicate Key
  if (err.code === 11000) {
    message = `Duplicate value entered for ${Object.keys(err.keyValue)} field`;
    statusCode = HTTP_STATUS.BAD_REQUEST;
    error = new AppError(statusCode, message);
  }

  // Mongoose Validation Error
  if (err.name === "ValidationError") {
    message = Object.values(err.errors)
      .map((val: any) => val.message)
      .join(", ");
    statusCode = HTTP_STATUS.BAD_REQUEST;
    error = new AppError(statusCode, message);
  }

  // Zod Validation Error
  if (err instanceof ZodError) {
    message = err.issues
      .map((e: any) => `${e.path.join(".")}: ${e.message}`)
      .join(", ");
    statusCode = HTTP_STATUS.BAD_REQUEST;
    error = new AppError(statusCode, message);
  }

  // Send Response
  res.status(statusCode).json({
    success: false,
    message: message,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
};
