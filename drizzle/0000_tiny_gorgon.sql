CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'banned');--> statement-breakpoint
CREATE TYPE "public"."content_item_type" AS ENUM('post', 'article');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('draft', 'scheduled', 'published');--> statement-breakpoint
CREATE TYPE "public"."reaction_type" AS ENUM('like', 'love', 'laugh', 'celebrate', 'support', 'sad', 'angry');--> statement-breakpoint
CREATE TYPE "public"."notification_entity_type" AS ENUM('CONTENT_ITEM', 'COMMENT', 'USER', 'MESSAGE', 'REPORT', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('WELCOME', 'REACTION', 'COMMENT', 'FOLLOW', 'SHARE', 'MENTION', 'REPORT', 'MESSAGE', 'SYSTEM', 'LOGIN_ALERT', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'ACCOUNT_STATUS');--> statement-breakpoint
CREATE TYPE "public"."notification_delivery_channel" AS ENUM('IN_APP', 'EMAIL');--> statement-breakpoint
CREATE TYPE "public"."notification_delivery_status" AS ENUM('PENDING', 'PROCESSING', 'SENT', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."interaction_event_target_type" AS ENUM('CONTENT_ITEM', 'COMMENT', 'USER');--> statement-breakpoint
CREATE TYPE "public"."interaction_event_type" AS ENUM('reaction.added', 'reaction.changed', 'reaction.removed', 'follow.created', 'follow.removed', 'save.created', 'save.removed', 'share.created');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fullname" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"username" text NOT NULL,
	"bio" text DEFAULT '',
	"headline" text DEFAULT '',
	"location" text DEFAULT '',
	"profile_image_url" text DEFAULT 'https://api.dicebear.com/7.x/adventurer/svg?seed=mail',
	"profile_image_public_id" text DEFAULT '',
	"banner_image_url" text DEFAULT '',
	"banner_image_public_id" text DEFAULT '',
	"youtube" text DEFAULT '',
	"instagram" text DEFAULT '',
	"facebook" text DEFAULT '',
	"twitter" text DEFAULT '',
	"github" text DEFAULT '',
	"website" text DEFAULT '',
	"linkedin" text DEFAULT '',
	"leetcode" text DEFAULT '',
	"geeksforgeeks" text DEFAULT '',
	"codeforces" text DEFAULT '',
	"total_posts" integer DEFAULT 0 NOT NULL,
	"total_reads" integer DEFAULT 0 NOT NULL,
	"total_followers" integer DEFAULT 0 NOT NULL,
	"total_following" integer DEFAULT 0 NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"login_attempts" integer DEFAULT 0 NOT NULL,
	"lock_until" bigint,
	"google_auth" boolean DEFAULT false NOT NULL,
	"github_auth" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"follower_id" uuid NOT NULL,
	"following_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_follower_id_following_id_pk" PRIMARY KEY("follower_id","following_id")
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_type" "content_item_type" NOT NULL,
	"author_id" uuid NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"publish_date" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"reaction_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"share_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_items_scheduled_at_check" CHECK ("content_items"."status" <> 'scheduled' OR "content_items"."scheduled_at" IS NOT NULL),
	CONSTRAINT "content_items_nonnegative_counters_check" CHECK ("content_items"."view_count" >= 0 AND "content_items"."reaction_count" >= 0 AND "content_items"."comment_count" >= 0 AND "content_items"."share_count" >= 0 AND "content_items"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"content_document" jsonb DEFAULT '{"version":1,"blocks":[]}'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"subtitle" text,
	"content_document" jsonb DEFAULT '{"version":1,"blocks":[]}'::jsonb NOT NULL,
	"excerpt" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"read_time" integer DEFAULT 0 NOT NULL,
	"cover_image_url" text,
	"cover_image_public_id" text,
	"cover_image_alt_text" text,
	"cover_image_credit" text,
	CONSTRAINT "articles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "post_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"url" text NOT NULL,
	"public_id" text,
	"position" integer NOT NULL,
	"alt_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_item_id" uuid NOT NULL,
	"mentioned_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content" varchar(2500) NOT NULL,
	"content_item_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_comment_id" uuid,
	"reaction_count" integer DEFAULT 0 NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"is_edited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_nonnegative_counters_check" CHECK ("comments"."reaction_count" >= 0 AND "comments"."reply_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "content_reactions" (
	"content_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reaction_type" "reaction_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_reactions_content_item_id_user_id_pk" PRIMARY KEY("content_item_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "comment_reactions" (
	"comment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reaction_type" "reaction_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_reactions_comment_id_user_id_pk" PRIMARY KEY("comment_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "content_saves" (
	"content_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_saves_content_item_id_user_id_pk" PRIMARY KEY("content_item_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "content_shares" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_id" uuid NOT NULL,
	"actor_id" uuid,
	"type" "notification_type" NOT NULL,
	"entity_type" "notification_entity_type",
	"related_id" uuid,
	"message" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"notification_id" integer NOT NULL,
	"channel" "notification_delivery_channel" NOT NULL,
	"status" "notification_delivery_status" DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_notification_id_channel_pk" PRIMARY KEY("notification_id","channel")
);
--> statement-breakpoint
CREATE TABLE "interaction_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"event_type" "interaction_event_type" NOT NULL,
	"target_type" "interaction_event_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_following_id_users_id_fk" FOREIGN KEY ("following_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_id_content_items_id_fk" FOREIGN KEY ("id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_id_content_items_id_fk" FOREIGN KEY ("id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_mentions" ADD CONSTRAINT "content_mentions_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_mentions" ADD CONSTRAINT "content_mentions_mentioned_user_id_users_id_fk" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_comment_id_comments_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reactions" ADD CONSTRAINT "content_reactions_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reactions" ADD CONSTRAINT "content_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_saves" ADD CONSTRAINT "content_saves_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_saves" ADD CONSTRAINT "content_saves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_shares" ADD CONSTRAINT "content_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_shares" ADD CONSTRAINT "content_shares_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_events" ADD CONSTRAINT "interaction_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "follows_following_created_idx" ON "follows" USING btree ("following_id","created_at");--> statement-breakpoint
CREATE INDEX "content_items_status_publish_date_id_idx" ON "content_items" USING btree ("status","publish_date","id");--> statement-breakpoint
CREATE INDEX "content_items_status_scheduled_at_idx" ON "content_items" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "content_items_author_created_idx" ON "content_items" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "post_media_post_position_uidx" ON "post_media" USING btree ("post_id","position");--> statement-breakpoint
CREATE INDEX "post_media_post_idx" ON "post_media" USING btree ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_mentions_item_user_uidx" ON "content_mentions" USING btree ("content_item_id","mentioned_user_id");--> statement-breakpoint
CREATE INDEX "content_mentions_user_created_idx" ON "content_mentions" USING btree ("mentioned_user_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_content_parent_created_id_idx" ON "comments" USING btree ("content_item_id","parent_comment_id","created_at","id");--> statement-breakpoint
CREATE INDEX "comments_parent_created_id_idx" ON "comments" USING btree ("parent_comment_id","created_at","id");--> statement-breakpoint
CREATE INDEX "content_reactions_user_created_idx" ON "content_reactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "content_saves_user_created_idx" ON "content_saves" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "content_shares_user_item_platform_idx" ON "content_shares" USING btree ("user_id","content_item_id","platform");--> statement-breakpoint
CREATE INDEX "content_shares_item_created_idx" ON "content_shares" USING btree ("content_item_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_recipient_is_read_idx" ON "notifications" USING btree ("recipient_id","is_read");--> statement-breakpoint
CREATE INDEX "notifications_recipient_created_idx" ON "notifications" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_status_idx" ON "notification_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "interaction_events_actor_created_idx" ON "interaction_events" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "interaction_events_target_created_idx" ON "interaction_events" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "interaction_events_type_created_idx" ON "interaction_events" USING btree ("event_type","created_at");