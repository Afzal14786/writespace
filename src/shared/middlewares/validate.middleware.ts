import { Request, Response, NextFunction } from "express";
import { z } from "zod";

export const validate =
  <T extends z.ZodObject>(schema: T) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse({
        body: req.body as unknown,
        query: req.query,
        params: req.params,
      });

      req.body = parsed.body as unknown;

      next();
    } catch (error) {
      next(error);
    }
  };
