import { Schema, model } from "mongoose";
import { IComment } from "./interface/comment.interface";

const CommentSchema = new Schema<IComment>(
  {
    content: { type: String, required: true, trim: true, maxlength: 1000 },
    post: {
      type: Schema.Types.ObjectId,
      ref: "Post",
      required: true,
      index: true,
    },
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    parentComment: {
      type: Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
      index: true,
    },
    stats: {
      likeCount: { type: Number, default: 0 },
      replyCount: { type: Number, default: 0 },
    },
    isEdited: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  },
);

// Virtual for replies could be added, but manual query is often more performant for threading
// CommentSchema.virtual('replies', {
//     ref: 'Comment',
//     localField: '_id',
//     foreignField: 'parentComment'
// });

export const CommentModel = model<IComment>("Comment", CommentSchema);
