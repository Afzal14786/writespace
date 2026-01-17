import { Schema, model, Document, Types } from "mongoose";

export interface ILike extends Document {
  user: Types.ObjectId;
  post: Types.ObjectId;
  createdAt: Date;
}

const LikeSchema = new Schema<ILike>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    post: { type: Schema.Types.ObjectId, ref: "Post", required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Prevent duplicate likes from the same user on the same post
LikeSchema.index({ user: 1, post: 1 }, { unique: true });

export const LikeModel = model<ILike>("Like", LikeSchema);
