ALTER TABLE "posts" ADD COLUMN "media" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "code_snippets" jsonb DEFAULT '[]'::jsonb;