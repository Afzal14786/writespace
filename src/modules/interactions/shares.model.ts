import { Schema, model } from "mongoose";
import { IShare } from "./interface/share.interface";

const ShareSchema = new Schema<IShare>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    post: { type: Schema.Types.ObjectId, ref: "Post", required: true },
    platform: { type: String, required: true, lowercase: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

ShareSchema.index({ user: 1, post: 1, platform: 1 }); // Track unique shares per platform if needed, or just log all

export const ShareModel = model<IShare>("Share", ShareSchema);
