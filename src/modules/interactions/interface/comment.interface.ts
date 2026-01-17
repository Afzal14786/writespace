import { Document, Types } from "mongoose";

export interface IComment extends Document {
  content: string;
  post: Types.ObjectId;
  author: Types.ObjectId;
  parentComment?: Types.ObjectId;
  replies: Types.ObjectId[]; // Virtual population usually, but good to have type def
  stats: {
    likeCount: number;
    replyCount: number;
  };
  isEdited: boolean;
  createdAt: Date;
  updatedAt: Date;
}
