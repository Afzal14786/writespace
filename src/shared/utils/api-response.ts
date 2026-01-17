import { Response } from "express";

/**
 * @class ApiResponse
 * @description Standardized generic wrapper for HTTP responses.
 * @template T - The type of the data payload. Defaults to 'unknown' or 'null' if not provided.
 */
export class ApiResponse<T> {
  /**
   * @constructor
   * @param {Response} res - The Express Response object (stored for sending later).
   * @param {number} statusCode - HTTP status code (e.g., 200, 201, 404).
   * @param {string} message - A human-readable message describing the operation result.
   * @param {T} data - The payload to return to the client.
   */
  constructor(
    private res: Response,
    private statusCode: number,
    private message: string,
    private data: T,
  ) {}

  /**
   * Sends the structured JSON response to the client.
   * Calculates 'success' boolean automatically based on the status code (200-299 is true).
   * @returns {Response} The Express response object.
   */
  public send(): Response {
    return this.res.status(this.statusCode).json({
      success: this.statusCode >= 200 && this.statusCode < 505,
      statusCode: this.statusCode,
      message: this.message,
      data: this.data,
      timestamp: new Date().toISOString(),
    });
  }
}
