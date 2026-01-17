import { Document, Types } from "mongoose";

export enum PostStatus {
  DRAFT = "draft",
  SCHEDULED = "scheduled",
  PUBLISHED = "published",
  ARCHIVED = "archived",
  TRASH = "trash",
}

export interface IPostMedia {
  url: string;
  altText?: string;
  credit?: string;
  mobileUrl?: string; // specific_mobile_url
}

export interface IPostSeries {
  seriesId: Types.ObjectId;
  order: number;
}

export interface IPostStats {
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
}

export interface IPost extends Document {
  // A. Identity & Core Content
  title: string;
  slug: string;
  subtitle?: string; // Summary/Hook
  content: string; // HTML or structured JSON string
  excerpt?: string; // Auto-generated if missing
  version: number;

  // B. Media & Assets
  coverImage?: IPostMedia;
  audioUrl?: string;
  attachments?: string[];

  // C. Taxonomy
  category?: Types.ObjectId;
  tags?: string[];
  series?: IPostSeries;

  // D. Ownership & Access
  author: Types.ObjectId;
  coAuthors?: Types.ObjectId[];
  isPremium: boolean;
  status: PostStatus;
  publishDate?: Date; // For scheduling

  // E. Metrics
  stats: IPostStats;
  readTime: number; // in minutes

  // Metadata
  createdAt: Date;
  updatedAt: Date;
}
