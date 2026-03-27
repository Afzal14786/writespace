import { Request, Response, NextFunction } from "express";

/**
 * @module ParseFormDataMiddleware
 * @description Intercepts multipart/form-data requests after Multer processing.
 * Detects stringified JSON arrays/objects in req.body and parses them back into native JavaScript objects
 * before they reach the Zod validation layer. 100% Type Safe.
 */
export const parseFormDataJson = (req: Request, res: Response, next: NextFunction): void => {
  // 1. Only process if the request is multipart/form-data
  if (req.headers["content-type"]?.includes("multipart/form-data")) {
    
    // 2. Safely type assert req.body as a generic dictionary to avoid 'any'
    const body = req.body as Record<string, unknown>;

    // 3. Define the specific fields we expect to be stringified JSON
    const jsonFields = [
      "tags", 
      "codeSnippets", 
      "personal_info", 
      "social_links"
    ];

    jsonFields.forEach((field) => {
      // 4. Narrow the type: If the field exists and is a string, attempt to parse it
      const fieldValue = body[field];
      if (typeof fieldValue === "string") {
        try {
          body[field] = JSON.parse(fieldValue) as unknown;
        } catch (error: unknown) {
          // If JSON.parse fails, we leave it as a string.
          // We do NOT throw an error here. We let the Zod validation layer (which runs next)
          // catch the type mismatch and return a standard 400 Bad Request to the user.
          if (error instanceof Error) {
            console.warn(`[ParseFormData] Failed to parse field '${field}': ${error.message}`);
          }
        }
      }
    });

    if (typeof body.isPublished === "string") {
      if (body.isPublished === "true") body.isPublished = true;
      if (body.isPublished === "false") body.isPublished = false;
    }

    // 5. Reassign the parsed body back to req.body
    req.body = body;
  }
  
  next();
};