import mongoose, { Schema } from "mongoose";
import { IPost, PostStatus } from "./interfaces/post.interface";

const PostSchema = new Schema<IPost>(
  {
    // A. Identity & Core Content
    title: { type: String, required: true, trim: true },

    /**
     * URL-friendly version of the title.
     * Why: Used for clean URLs and SEO. Indexed for fast lookup.
     */
    slug: { type: String, required: true, unique: true, index: true },

    /**
     * Dedicated summary or "hook" for social media cards.
     */
    subtitle: { type: String, trim: true },

    /**
     * The heavy body content (HTML or JSON).
     * Note: Can be structured JSON blocks for mobile/web formatting.
     */
    content: { type: String, required: true },

    excerpt: { type: String },
    version: { type: Number, default: 1 },

    // B. Media & Assets
    coverImage: {
      url: { type: String },
      altText: { type: String },
      credit: { type: String },
      mobileUrl: { type: String }, // Why: Different image sizes for mobile vs desktop
    },
    audioUrl: { type: String },
    attachments: [{ type: String }],

    // C. Taxonomy
    category: { type: Schema.Types.ObjectId, ref: "Category", index: true },
    tags: [{ type: String, index: true }], // "Micro-categories" for search
    series: {
      seriesId: { type: Schema.Types.ObjectId, ref: "Series" },
      order: { type: Number },
    },

    // D. Ownership & Access
    author: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    coAuthors: [{ type: Schema.Types.ObjectId, ref: "User" }], // Allow multiple editors
    isPremium: { type: Boolean, default: false }, // Locks content for paid subscribers
    status: {
      type: String,
      enum: Object.values(PostStatus),
      default: PostStatus.DRAFT,
      index: true,
    },
    publishDate: { type: Date },

    // E. Metrics
    /**
     * Why: Stored directly on the document to avoid expensive count queries on interaction tables
     * every time the homepage loads.
     */
    stats: {
      viewCount: { type: Number, default: 0 },
      likeCount: { type: Number, default: 0 },
      commentCount: { type: Number, default: 0 },
      shareCount: { type: Number, default: 0 },
    },
    readTime: { type: Number, default: 0 },
  },
  {
    timestamps: true, // Auto-manages createdAt and updatedAt
  },
);

// Compound index for efficient feed queries (e.g., "Give me latest published posts")
PostSchema.index({ status: 1, publishDate: -1 });

export const PostModel = mongoose.model<IPost>("Post", PostSchema);
