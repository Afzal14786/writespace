# WriteSpace Backend API

> A robust, scalable backend for a modern blogging platform.

## Overview

WriteSpace is a RESTful API built with **Node.js** and **TypeScript**, designed to power a professional blogging platform. It supports role-based authentication, rich content management, social interactions (likes, comments, shares), and asynchronous notifications.

## Tech Stack

- **Runtime**: Bun / Node.js (v18+)
- **Framework**: Express.js 5
- **Language**: TypeScript
- **Database**: PostgreSQL (Drizzle ORM)
- **Caching & Queues**: Redis, BullMQ
- **Authentication**: Passport.js, JWT (dual access/refresh tokens)
- **Email**: Nodemailer
- **File Uploads**: Multer + AWS S3
- **Validation**: Zod
- **Logging**: Zario

## Project Structure

```
writespace/
├── src/
│   ├── config/                # Global configurations
│   │   ├── env.ts             # Environment variable validation (Zod)
│   │   ├── redis.ts           # Redis client setup
│   │   └── logger.ts          # Zario logger setup
│   │
│   ├── db/                    # Database layer
│   │   ├── index.ts           # pg Pool + Drizzle instance
│   │   └── schema/            # Drizzle table definitions
│   │       ├── users.ts
│   │       ├── posts.ts
│   │       ├── comments.ts
│   │       ├── likes.ts
│   │       ├── shares.ts
│   │       ├── notifications.ts
│   │       ├── relations.ts   # Drizzle relational definitions
│   │       └── index.ts       # Re-exports all schema
│   │
│   ├── modules/               # Vertical slices (feature-based)
│   │   ├── auth/              # Authentication (register, login, OAuth, password reset)
│   │   ├── users/             # User management (CRUD, ownership checks)
│   │   ├── posts/             # Blog posts (CRUD, pagination, likes, shares)
│   │   ├── interactions/      # Comments, likes, shares
│   │   └── notification/      # Email templates & notification service
│   │
│   ├── shared/                # Cross-cutting concerns
│   │   ├── constants/         # HTTP status codes
│   │   ├── infra/             # External service wrappers (mailer)
│   │   ├── middlewares/       # Auth, error handling, validation, rate limiting, uploads
│   │   ├── queues/            # BullMQ email & interaction workers
│   │   ├── utils/             # ApiResponse, AppError, catchAsync
│   │   └── types/             # Express.d.ts augmentation
│   │
│   ├── app.ts                 # Express app setup (middleware registration)
│   └── server.ts              # Entry point (graceful shutdown)
│
├── drizzle.config.ts          # Drizzle Kit configuration
├── tsconfig.json
└── package.json
```

## Getting Started

### Prerequisites

- Bun (or Node.js v18+)
- PostgreSQL
- Redis

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/Afzal14786/writespace.git
   cd writespace
   ```

2. **Install dependencies**

   ```bash
   bun install
   ```

3. **Configure environment**

   Create a `.env` file in the root directory:

   ```env
   PORT=5000
   DATABASE_URL=postgresql://user:password@localhost:5432/writespace
   REDIS_URL=redis://localhost:6379
   JWT_ACCESS_SECRET=your_access_secret
   JWT_REFRESH_SECRET=your_refresh_secret
   JWT_ACCESS_EXPIRE=15m
   CLIENT_URL=http://localhost:3000
   ```

4. **Generate & run migrations**

   ```bash
   bunx drizzle-kit generate
   bunx drizzle-kit migrate
   ```

5. **Start development server**
   ```bash
   bun run dev
   ```

## Database

WriteSpace uses **PostgreSQL** with **Drizzle ORM** for type-safe schema definitions and queries.

- Schemas defined in `src/db/schema/` with native `uuid` primary keys (database-generated)
- Relational definitions in `src/db/schema/relations.ts` for Drizzle's relational query API
- Connection pooling via `pg.Pool` (min: 2, max: 10)
- Migrations managed by Drizzle Kit

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
