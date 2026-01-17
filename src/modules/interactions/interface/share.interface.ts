import { Document, Types } from "mongoose";

export interface IShare extends Document {
  user: Types.ObjectId;
  post: Types.ObjectId;
  platform: string; // 'twitter', 'facebook', 'linkedin', 'generic'
  createdAt: Date;
}
