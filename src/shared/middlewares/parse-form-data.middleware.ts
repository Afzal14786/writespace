import { Request, Response, NextFunction } from "express";
import logger from "@config/logger";

/**
 * Parses JSON-encoded fields sent through multipart/form-data.
 *
 * Multer exposes multipart text fields as strings. Fields such as
 * tags and codeSnippets may therefore arrive as JSON strings and
 * need to be converted back into their native JavaScript structures
 * before Zod validation.
 */
export const parseFormDataJson = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  if (!req.headers["content-type"]?.includes("multipart/form-data")) {
    next();
    return;
  }

  const body = req.body as Record<string, unknown>;

  const jsonFields = [
    "tags",
    "codeSnippets",
    "existingMedia",
    "existingMediaPublicIds",
  ];

  for (const field of jsonFields) {
    const fieldValue = body[field];

    if (typeof fieldValue !== "string") {
      continue;
    }

    try {
      body[field] = JSON.parse(fieldValue) as unknown;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message: String(error);
      logger.warn(`[ParseFormData] Failed to parse field '${field}': ${message}`);
    }
  }

  req.body = body;

  next();
};
