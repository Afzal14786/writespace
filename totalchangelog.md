# WriteSpace Total Changelog

All changes across 3 sessions of refactoring and migration.

---

## Session 1 & 2: Bug Fixes & Security Hardening

### Auth & Security

- **auth.middleware.ts**: Fixed broken RBAC `authorize` middleware — was reading wrong path for role, now reads `req.user.role` from JWT.
- **express.d.ts**: Updated `Request.user` type to `{ id: string; role?: string; [key: string]: any }` matching JWT payload shape.
- **auth.utils.ts**: Replaced insecure `Math.random()` OTP generation with `crypto.randomInt()`.
- **auth.service.ts**: Split `JWT_SECRET` into `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET`. Implemented refresh token rotation with reuse detection.
- **auth.routes.ts**: Applied `authLimiter` rate limiter to all auth endpoints.
- **env.ts**: Updated Zod schema to require separate `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`.
- **password-reset.dto.ts** (new): Added Zod DTO for password reset. Full password reset flow added to auth service/controller/routes (`forgotPassword`, `resetPassword`).

### Data Integrity & Access Control

- **user.service.ts**: Fixed mass assignment vulnerability — added field whitelists for `updateUser`.
- **user.routes.ts**: Changed `authorize("admin")` to `authorize("admin", "user")` on PUT and DELETE routes.
- **user.controller.ts**: Added ownership checks (users can only update/delete own profile, admins bypass). Implemented `deleteUser` as soft-delete (sets status to "suspended").
- **user.service.ts**: Added `deleteUser()` method.
- **api-response.ts**: Fixed success check from `< 505` to `< 300`.

### Posts & Interactions

- **posts.controller.ts**: `createPost` reads `req.file.location` (S3 URL) for `coverImage`. `getPost` uses `.lean()`. Real pagination with `page`/`limit` query params. Fixed `req.user?.role` references.
- **interactions.service.ts**: Cascade delete for comment replies. MongoDB transactions for comment create/delete.
- **posts.service.ts**: MongoDB transaction for like toggle.
- **interactions.controllers.ts**: Fixed `req.user?.role` references.

### Infrastructure

- **logger.ts**: Replaced `winston` with `zario` logger.
- **httpLogger.ts**: Changed `logger.http()` to `logger.debug()`.
- **mailer.ts**: Removed error-swallowing try/catch.
- **comments.model.ts**: Added compound index `{ post: 1, parentComment: 1, createdAt: -1 }`.
- **db.ts**: Added connection pooling, retry logic (3 attempts), `process.exit(1)` on failure.
- **server.ts**: Graceful shutdown — SIGTERM/SIGINT closes HTTP server, BullMQ workers, Redis, and DB.
- **auth.controller.ts**: All 7 response paths now use `ApiResponse` instead of raw `res.json()`.
- **.env**: Created with all required environment variables.

---

## Session 3: MongoDB to PostgreSQL/Drizzle ORM Migration

Complete rip-and-replace of MongoDB/Mongoose with PostgreSQL/Drizzle ORM.

### Dependencies

- **Added**: `drizzle-orm`, `pg`, `drizzle-kit` (dev), `@types/pg` (dev)
- **Removed**: `mongoose`, `@types/mongoose`

### Environment

- **`.env`**: `MONGO_URI` replaced with `DATABASE_URL=postgresql://...`
- **`src/config/env.ts`**: Zod schema changed from `MONGO_URI` to `DATABASE_URL`

### New Files

- **`src/db/schema/users.ts`**: `users` table with flattened columns (was nested `personal_info`, `social_links`, `account_info`). Text PK, `pgEnum` for status/role.
- **`src/db/schema/posts.ts`**: `posts` table with flattened `coverImage` and `stats` columns. `postCoauthors` join table. Indexes on `(status, publishDate)` and `authorId`.
- **`src/db/schema/comments.ts`**: Self-referencing `parentCommentId`. Compound index `(postId, parentCommentId, createdAt)`.
- **`src/db/schema/likes.ts`**: Composite PK `(userId, postId)` — no separate id column.
- **`src/db/schema/shares.ts`**: Serial PK, index on `(userId, postId, platform)`.
- **`src/db/schema/notifications.ts`**: Serial PK, `pgEnum` for notification type, index on `(recipientId, isRead)`.
- **`src/db/schema/index.ts`**: Re-exports all schema files.
- **`src/db/index.ts`**: `pg.Pool` + `drizzle()` instance. Exports `pool` and `db`.
- **`drizzle.config.ts`**: Drizzle Kit config pointing to schema files.

### Rewritten Interfaces

- **`user.interface.ts`**: Removed `IUser extends Document`, `IPersonalInfo`, `ISocialMediaLinks`, `IAccountInfo`, `IUserModel`. Now re-exports `User` from Drizzle schema + `PublicUser` type (omits sensitive fields).
- **`post.interface.ts`**: Removed `IPost extends Document`, `IPostMedia`, `IPostSeries`, `IPostStats`. Now re-exports `Post` from Drizzle schema. `PostStatus` enum preserved.
- **`comment.interface.ts`**: Removed `IComment extends Document`. Re-exports `Comment` type.
- **`share.interface.ts`**: Removed `IShare extends Document`. Re-exports `Share` type.
- **`like.interface.ts`**: Was empty, now re-exports `Like` type.
- **`notification.interface.ts`**: Removed `INotification extends Document`. Kept `NotificationType` enum and `IEmailJob` interface.

### Rewritten Services

- **`auth.service.ts`**:
  - All Mongoose queries replaced with Drizzle (`db.select()`, `db.insert()`, `db.update()`).
  - Explicit `bcrypt.hash()` before insert (no more Mongoose pre-save hook).
  - Explicit `bcrypt.compare()` replacing `user.comparePassword()`.
  - Manual `toPublicUser()` function replacing `user.getPublicProfile()`.
  - `signTokens()` now accepts `role` parameter — reads actual role from DB instead of hardcoding `"user"`.
  - New user IDs generated with `crypto.randomUUID()`.

- **`user.service.ts`**:
  - All Mongoose queries replaced with Drizzle.
  - Field whitelist maps DTO nested paths (`personal_info.fullname`) to flat Drizzle columns (`fullname`).
  - `deleteUser` uses Drizzle `update` to set status to "suspended".

- **`posts.service.ts`**:
  - All Mongoose queries replaced with Drizzle.
  - `getPosts()` and `getPost()` moved from controller into service.
  - `.populate("author", ...)` replaced with SQL `leftJoin` to users table.
  - `likePost()` uses `db.transaction()` instead of Mongoose sessions.
  - `generateUniqueSlug()` uses Drizzle select.
  - New post IDs generated with `crypto.randomUUID()`.

- **`posts.controller.ts`**:
  - Removed direct `PostModel` import.
  - `getPosts` and `getPost` now delegate to `postService`.

- **`interactions.service.ts`**:
  - All Mongoose queries replaced with Drizzle.
  - `createComment()` uses `db.transaction()`.
  - `deleteComment()` cascade-deletes replies within transaction.
  - `.populate("author", ...)` replaced with `leftJoin`.
  - New comment IDs generated with `crypto.randomUUID()`.

- **`interaction.worker.ts`**: `NotificationModel.create()` replaced with `db.insert(notifications).values()`.

- **`notification.service.ts`**: Removed `NotificationModel` import (was unused after worker handles DB writes).

### Infrastructure Updates

- **`app.ts`**: Removed `connectDB()` (MongoDB). Added `pool.query("SELECT 1")` health check for PostgreSQL. Imports `pool` from `src/db`.
- **`server.ts`**: Replaced `mongoose.connection.close()` with `pool.end()` in graceful shutdown.
- **`src/config/db.ts`**: Deleted (was MongoDB connector).

### Deleted Files

- `src/modules/users/user.model.ts`
- `src/modules/posts/posts.model.ts`
- `src/modules/interactions/comments.model.ts`
- `src/modules/interactions/like.model.ts`
- `src/modules/interactions/shares.model.ts`
- `src/modules/notification/notification.model.ts`
- `src/config/db.ts`

### API Response Shape Changes

The old Mongoose-based API returned nested user objects:

```json
{
  "personal_info": { "username": "...", "email": "..." },
  "social_links": { "twitter": "..." },
  "account_info": { "total_posts": 0, "status": "active" }
}
```

The new Drizzle-based API returns flat user objects:

```json
{
  "id": "...",
  "fullname": "...",
  "email": "...",
  "username": "...",
  "bio": "...",
  "twitter": "...",
  "totalPosts": 0,
  "status": "active"
}
```

Post author population changed from `personal_info.username` to `{ username, profileImageUrl }` on the `author` field.

### Verification

- `bunx tsc --noEmit` passes with zero errors.
- Zero remaining `mongoose` imports in the codebase.
- Zero remaining references to old Mongoose model files.
