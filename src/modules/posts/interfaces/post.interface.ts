import { Post } from "../../../db/schema";

export type { Post };

export enum PostStatus {
  DRAFT = "draft",
  SCHEDULED = "scheduled",
  PUBLISHED = "published",
  ARCHIVED = "archived",
  TRASH = "trash",
}
