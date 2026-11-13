import multer, { FileFilterCallback, StorageEngine } from "multer";
import {
  v2 as cloudinary,
  UploadApiErrorResponse,
  UploadApiResponse,
} from "cloudinary";
import path from "path";
import { Request } from "express";
import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import env from "@config/env";
import type { CloudinaryFileFields } from "@shared/types/cloudinary-file";

/**
 * @module UploadMiddleware
 * @description Configures Multer with Cloudinary storage.
 * Supports multi-file uploads, validates image types, and enforces size limits.
 */

// 1. Configure Cloudinary client
cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

const ALLOWED_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
]);

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

/**
 * File filter to restrict uploads to allowed image types.
 */
const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
): void => {
  const extension = path.extname(file.originalname).toLowerCase();
  const mimeType = file.mimetype.toLowerCase();

  const isAllowedExtension = ALLOWED_IMAGE_EXTENSIONS.has(extension);

  const isAllowedMimeType = ALLOWED_IMAGE_MIME_TYPES.has(mimeType);

  if (isAllowedExtension && isAllowedMimeType) {
    cb(null, true);
    return;
  }

  cb(
    new AppError(
      HTTP_STATUS.BAD_REQUEST,
      "Invalid file type. Only JPEG, JPG, PNG, GIF, and WEBP images are allowed.",
    ),
  );
};

/**
 * Custom Multer storage engine that streams uploads to Cloudinary.
 */
class CloudinaryStorageEngine implements StorageEngine {
  _handleFile(
    req: Request,
    file: Express.Multer.File,
    callback: (
      error?: Error | null,
      info?: Partial<Express.Multer.File> & CloudinaryFileFields,
    ) => void,
  ): void {
    const userId = req.user?.id || "anonymous";
    const timestamp = Date.now();

    const cleanName = file.originalname
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9.\-_]/g, "")
      .toLowerCase();

    const folder = `uploads/users/${userId}`;
    const publicId = `${timestamp}-${cleanName}`;

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: "image",
      },
      (
        error: UploadApiErrorResponse | undefined,
        result: UploadApiResponse | undefined,
      ): void => {
        if (error || !result) {
          callback(
            error
              ? new Error(error.message)
              : new Error("Cloudinary upload failed"),
          );
          return;
        }

        callback(null, {
          path: result.secure_url,
          filename: result.public_id,
          size: result.bytes,
          location: result.secure_url,
          key: result.public_id,
          public_id: result.public_id,
          secure_url: result.secure_url,
        });
      },
    );

    file.stream.pipe(uploadStream);
  }

  _removeFile(
    req: Request,
    file: Express.Multer.File & Partial<CloudinaryFileFields>,
    callback: (error: Error | null) => void,
  ): void {
    const publicId = file.public_id || file.filename;

    if (!publicId) {
      callback(null);
      return;
    }

    cloudinary.uploader.destroy(
      publicId,
      (error: UploadApiErrorResponse | null): void => {
        callback(error ? new Error(error.message) : null);
      },
    );
  }
}

const cloudinaryStorage = new CloudinaryStorageEngine();

export const upload = multer({
  storage: cloudinaryStorage,
  limits: {
    fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024,
    files: env.MAX_FILES_PER_UPLOAD,
  },
  fileFilter,
});
