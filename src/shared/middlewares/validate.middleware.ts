import { Request, Response, NextFunction } from "express";
import { AnyZodObject, ZodError, ZodIssue } from "zod";
import { AppError } from "../utils/app.error";
import { HTTP_STATUS } from "../constants/http-codes";

export const validate =
  (schema: AnyZodObject) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    try {
      schema.parse({
        body: req.body as unknown,
        query: req.query as unknown,
        params: req.params as unknown,
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const messages = error.errors
          .map((e: ZodIssue) => `${e.path.join(".")}: ${e.message}`)
          .join(", ");
        next(
          new AppError(
            HTTP_STATUS.BAD_REQUEST,
            `Validation Error: ${messages}`
          )
        );
      } else {
        next(error);
      }
    }
  };