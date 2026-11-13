CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'banned');--> statement-breakpoint
CREATE TYPE "public"."content_item_type" AS ENUM('post', 'article');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('draft', 'scheduled', 'published');--> statement-breakpoint
CREATE TYPE "public"."reaction_type" AS ENUM('like', 'love', 'laugh', 'celebrate', 'support', 'sad', 'angry');--> statement-breakpoint
CREATE TYPE "public"."interaction_event_target_type" AS ENUM('CONTENT_ITEM', 'COMMENT', 'USER');--> statement-breakpoint
CREATE TYPE "public"."interaction_event_type" AS ENUM('reaction.added', 'reaction.changed', 'reaction.removed', 'follow.created', 'follow.removed', 'save.created', 'save.removed', 'share.created');--> statement-breakpoint
CREATE TYPE "public"."outbox_event_status" AS ENUM('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');--> statement-breakpoint
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
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"source_event_id" uuid,
	"notification_type" text NOT NULL,
	"category" text NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"presentation_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"action_type" text,
	"dedupe_key" text,
	"group_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"read_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_priority_check" CHECK ("notifications"."priority" IN ('critical', 'high', 'normal', 'low')),
	CONSTRAINT "notifications_status_check" CHECK ("notifications"."status" IN ('active', 'archived', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "notification_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"grouping_key" text NOT NULL,
	"grouping_window_start" timestamp with time zone NOT NULL,
	"activity_type" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"group_count" integer NOT NULL,
	"first_activity_at" timestamp with time zone NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_groups_count_positive_check" CHECK ("notification_groups"."group_count" > 0),
	CONSTRAINT "notification_groups_status_check" CHECK ("notification_groups"."status" IN ('active', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "notification_group_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"notification_id" uuid,
	"source_event_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean NOT NULL,
	"frequency" text DEFAULT 'immediate' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_category_channel_pk" PRIMARY KEY("user_id","category","channel"),
	CONSTRAINT "notification_preferences_channel_check" CHECK ("notification_preferences"."channel" IN ('in_app', 'email', 'browser_push')),
	CONSTRAINT "notification_preferences_frequency_check" CHECK ("notification_preferences"."frequency" IN ('immediate', 'daily_digest', 'weekly_digest'))
);
--> statement-breakpoint
CREATE TABLE "notification_user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"quiet_hours_enabled" boolean DEFAULT false NOT NULL,
	"quiet_hours_start" time,
	"quiet_hours_end" time,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_user_settings_quiet_hours_check" CHECK (
        "notification_user_settings"."quiet_hours_enabled" = false
        OR (
          "notification_user_settings"."quiet_hours_start" IS NOT NULL
          AND "notification_user_settings"."quiet_hours_end" IS NOT NULL
          AND "notification_user_settings"."quiet_hours_start" <> "notification_user_settings"."quiet_hours_end"
        )
      )
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid,
	"group_id" uuid,
	"recipient_user_id" uuid,
	"source_event_id" uuid,
	"channel" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"lease_expires_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"confirmed_delivered_at" timestamp with time zone,
	"provider_message_id" text,
	"last_error_code" text,
	"expires_at" timestamp with time zone,
	"policy_version" text NOT NULL,
	"eligibility_decision" text NOT NULL,
	"reason_code" text,
	"preference_evaluated_at" timestamp with time zone,
	"scheduled_for" timestamp with time zone,
	"template_version" text,
	"locale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_channel_check" CHECK ("notification_deliveries"."channel" IN ('realtime', 'email', 'browser_push')),
	CONSTRAINT "notification_deliveries_status_check" CHECK ("notification_deliveries"."status" IN (
        'queued',
        'processing',
        'accepted',
        'delivered',
        'retryable_failed',
        'permanent_failed',
        'suppressed',
        'unknown',
        'dead_lettered'
      )),
	CONSTRAINT "notification_deliveries_attempt_count_check" CHECK ("notification_deliveries"."attempt_count" >= 0),
	CONSTRAINT "notification_deliveries_eligibility_check" CHECK ("notification_deliveries"."eligibility_decision" IN (
        'eligible',
        'deferred',
        'suppressed'
      )),
	CONSTRAINT "notification_deliveries_idempotency_key_not_empty_check" CHECK (length(trim("notification_deliveries"."idempotency_key")) > 0),
	CONSTRAINT "notification_deliveries_policy_version_not_empty_check" CHECK (length(trim("notification_deliveries"."policy_version")) > 0),
	CONSTRAINT "notification_deliveries_lease_state_check" CHECK ((
        (
          "notification_deliveries"."status" = 'processing'
          AND "notification_deliveries"."locked_at" IS NOT NULL
          AND "notification_deliveries"."locked_by" IS NOT NULL
          AND length(trim("notification_deliveries"."locked_by")) > 0
          AND "notification_deliveries"."lease_expires_at" IS NOT NULL
        )
        OR
        (
          "notification_deliveries"."status" <> 'processing'
          AND "notification_deliveries"."locked_at" IS NULL
          AND "notification_deliveries"."locked_by" IS NULL
          AND "notification_deliveries"."lease_expires_at" IS NULL
        )
      ))
);
--> statement-breakpoint
CREATE TABLE "notification_delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"outcome" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"latency_ms" bigint,
	"error_code" text,
	"provider_response_code" text,
	"provider_message_id" text,
	CONSTRAINT "notification_delivery_attempts_number_positive_check" CHECK ("notification_delivery_attempts"."attempt_number" > 0),
	CONSTRAINT "notification_delivery_attempts_latency_nonnegative_check" CHECK ("notification_delivery_attempts"."latency_ms" IS NULL OR "notification_delivery_attempts"."latency_ms" >= 0),
	CONSTRAINT "notification_delivery_attempts_outcome_check" CHECK ("notification_delivery_attempts"."outcome" IN (
        'processing',
        'accepted',
        'delivered',
        'transient_failure',
        'permanent_failure',
        'ambiguous',
        'suppressed'
      )),
	CONSTRAINT "notification_delivery_attempts_completion_check" CHECK ((
        ("notification_delivery_attempts"."outcome" = 'processing' AND "notification_delivery_attempts"."completed_at" IS NULL)
        OR
        ("notification_delivery_attempts"."outcome" <> 'processing' AND "notification_delivery_attempts"."completed_at" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "notification_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"destination_fingerprint" text NOT NULL,
	"reason" text NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_name" text NOT NULL,
	"event_version" integer DEFAULT 1 NOT NULL,
	"producer" text NOT NULL,
	"aggregate_type" text,
	"aggregate_id" text,
	"actor_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"correlation_id" text,
	"causation_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "outbox_event_status" DEFAULT 'PENDING' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"lease_expires_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	"published_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_event_version_positive_check" CHECK ("outbox_events"."event_version" > 0),
	CONSTRAINT "outbox_events_attempt_count_nonnegative_check" CHECK ("outbox_events"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"consumer_name" text NOT NULL,
	"event_id" uuid NOT NULL,
	"outcome" text DEFAULT 'processing' NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_events_consumer_name_event_id_pk" PRIMARY KEY("consumer_name","event_id"),
	CONSTRAINT "processed_events_outcome_check" CHECK ("processed_events"."outcome" IN (
        'processing',
        'notification_created',
        'group_updated',
        'expired',
        'no_delivery_required'
      ))
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
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_group_id_notification_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."notification_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_groups" ADD CONSTRAINT "notification_groups_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_group_events" ADD CONSTRAINT "notification_group_events_group_id_notification_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."notification_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_group_events" ADD CONSTRAINT "notification_group_events_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_group_events" ADD CONSTRAINT "notification_group_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_user_settings" ADD CONSTRAINT "notification_user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_group_id_notification_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."notification_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_delivery_id_notification_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."notification_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_events" ADD CONSTRAINT "interaction_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
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
CREATE INDEX "notifications_recipient_created_id_idx" ON "notifications" USING btree ("recipient_user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_active_unread_idx" ON "notifications" USING btree ("recipient_user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "notifications"."status" = 'active'
          AND "notifications"."read_at" IS NULL
          AND "notifications"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_recipient_dedupe_uq" ON "notifications" USING btree ("recipient_user_id","dedupe_key") WHERE "notifications"."dedupe_key" IS NOT NULL
          AND "notifications"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_group_uq" ON "notifications" USING btree ("group_id") WHERE "notifications"."group_id" IS NOT NULL
          AND "notifications"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_groups_active_window_uq" ON "notification_groups" USING btree ("recipient_user_id","grouping_key","grouping_window_start") WHERE "notification_groups"."status" = 'active';--> statement-breakpoint
CREATE INDEX "notification_groups_recipient_activity_idx" ON "notification_groups" USING btree ("recipient_user_id","last_activity_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_group_events_group_source_uq" ON "notification_group_events" USING btree ("group_id","source_event_id");--> statement-breakpoint
CREATE INDEX "notification_group_events_source_event_idx" ON "notification_group_events" USING btree ("source_event_id");--> statement-breakpoint
CREATE INDEX "notification_group_events_group_occurred_idx" ON "notification_group_events" USING btree ("group_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_idempotency_key_uq" ON "notification_deliveries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "notification_deliveries_schedule_idx" ON "notification_deliveries" USING btree ("status","next_attempt_at","created_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_processing_lease_idx" ON "notification_deliveries" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_recipient_created_idx" ON "notification_deliveries" USING btree ("recipient_user_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_notification_idx" ON "notification_deliveries" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_group_idx" ON "notification_deliveries" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_delivery_attempts_delivery_number_uq" ON "notification_delivery_attempts" USING btree ("delivery_id","attempt_number");--> statement-breakpoint
CREATE INDEX "notification_delivery_attempts_delivery_idx" ON "notification_delivery_attempts" USING btree ("delivery_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_suppressions_channel_destination_uq" ON "notification_suppressions" USING btree ("channel","destination_fingerprint");--> statement-breakpoint
CREATE INDEX "notification_suppressions_created_idx" ON "notification_suppressions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "interaction_events_actor_created_idx" ON "interaction_events" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "interaction_events_target_created_idx" ON "interaction_events" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "interaction_events_type_created_idx" ON "interaction_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "outbox_events_status_available_created_idx" ON "outbox_events" USING btree ("status","available_at","created_at");--> statement-breakpoint
CREATE INDEX "outbox_events_status_lease_expires_idx" ON "outbox_events" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "outbox_events_name_created_idx" ON "outbox_events" USING btree ("event_name","created_at");--> statement-breakpoint
CREATE INDEX "outbox_events_aggregate_idx" ON "outbox_events" USING btree ("aggregate_type","aggregate_id","occurred_at");--> statement-breakpoint
CREATE INDEX "processed_events_event_id_idx" ON "processed_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "processed_events_processed_at_idx" ON "processed_events" USING btree ("processed_at");