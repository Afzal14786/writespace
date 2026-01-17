import { Request, Response, NextFunction } from "express";
import { ZodObject, ZodError, ZodIssue } from "zod";
import { AppError } from "../utils/app.error";
import { HTTP_STATUS } from "../constants/http-codes";

export const validate =
  (schema: ZodObject<any, any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
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
            `Validation Error: ${messages}`,
          ),
        );
      } else {
        next(error);
      }
    }
  };
