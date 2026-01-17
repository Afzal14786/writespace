import multer, { FileFilterCallback } from "multer";
import multerS3 from "multer-s3";
import { S3Client } from "@aws-sdk/client-s3";
import path from "path";
import { Request } from "express";
import { AppError } from "../utils/app.error";
import { HTTP_STATUS } from "../constants/http-codes";
import env from "../../config/env";

/**
 * @module UploadMiddleware
 * @description Configures Multer with Amazon S3 storage for handling file uploads.
 * Supports multi-file uploads, validates file types (images only), and enforces size limits.
 */

// 1. Configure AWS S3 Client using AWS SDK v3
const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * File filter to restrict uploads to allowed image types.
 * @param {Request} req - Express request object.
 * @param {Express.Multer.File} file - Uploaded file object.
 * @param {FileFilterCallback} cb - Callback to accept or reject the file.
 */
const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
) => {
  const filetypes = /jpeg|jpg|png|gif|webp/;
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = filetypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    // Pass an error to the callback if the file type is invalid
    cb(
      new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "Invalid file type. Only JPEG, JPG, PNG, GIF, and WEBP images are allowed.",
      ),
    );
  }
};

/**
 * Multer S3 Storage Engine Configuration.
 * Defines how and where files are stored in the S3 bucket.
 */
const s3Storage = multerS3({
  s3: s3,
  bucket: env.AWS_BUCKET_NAME,
  contentType: multerS3.AUTO_CONTENT_TYPE, // Automatically detect and set content-type
  metadata: function (
    req: Request,
    file: Express.Multer.File,
    cb: (error: any, metadata?: any) => void,
  ) {
    cb(null, { fieldName: file.fieldname });
  },
  key: function (
    req: Request,
    file: Express.Multer.File,
    cb: (error: any, key?: string) => void,
  ) {
    // Folder structure strategy: uploads/users/{userId}/{timestamp}-{sanitizedFilename}
    // Utilizing req.user safely thanks to express.d.ts augmentation
    const userId = req.user?.id || "anonymous";
    const timestamp = Date.now();
    // Sanitize filename: replace spaces with dashes and convert to lowercase
    const cleanName = file.originalname
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9.\-_]/g, "")
      .toLowerCase();

    const fullPath = `uploads/users/${userId}/${timestamp}-${cleanName}`;
    cb(null, fullPath);
  },
});

/**
 * Exported Multer Instance.
 * Use this middleware in routes to handle 'multipart/form-data'.
 * Example: router.post('/upload', upload.array('images', 5), controller.handleUpload);
 */
export const upload = multer({
  storage: s3Storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit per file
    files: 5, // Limit max number of files per upload to 5 (prevent DoS)
  },
  fileFilter: fileFilter,
});
