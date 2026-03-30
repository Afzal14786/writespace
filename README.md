# WriteSpace API

> Production-grade blogging platform backend — RESTful API with role-based auth, social interactions, and async notifications.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express-5.0-black)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7.2-DC382D)](https://redis.io/)
[![Drizzle](https://img.shields.io/badge/Drizzle-ORM-green)](https://orm.drizzle.team/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

## 📖 Table of Contents
- [🚀 Features](#-features)
- [🏗️ Architecture Overview](#️-architecture-overview)
- [⚡ Quick Start](#-quick-start)
- [📁 Project Structure](#-project-structure)
- [🔗 API Endpoints](#-api-endpoints)
- [🧪 Testing](#-testing)
- [📦 Deployment](#-deployment)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

## 🚀 Features
| Category | Features |
|----------|----------|
| **Authentication** | JWT with refresh rotation, OAuth2 (Google/GitHub), password reset, role-based access (user/admin) |
| **Content Management** | Rich text posts, drafts, scheduled publishing, post sharing |
| **Social Interactions** | Likes, comments (threaded replies), shares, user profiles with shareable links |
| **Notifications** | Email + in-app notifications via BullMQ queues, async processing |
| **Media Handling** | AWS S3 uploads with Multer, multipart form-data support |
| **API Design** | RESTful, cursor/offset pagination, rate-limited (100 req/15min), consistent error responses |

## 🏗️ Architecture Overview

```mermaid
graph TD
    Client[Client Application] -->|HTTP| API[Express Server]
    API --> Auth[Auth Middleware]
    Auth --> Rate[Rate Limiter]
    Rate --> Controller[Module Controller]
    Controller --> Service[Module Service]
    Service --> DB[(PostgreSQL)]
    Service --> Cache[(Redis Cache)]
    Service --> Queue[BullMQ Queue]
    Queue --> Email[Email Worker]
    Queue --> Notif[Notification Worker]
    Email --> SMTP[Nodemailer]
    Service --> S3[AWS S3]
```

## Key Architectural Decisions:

-  **Vertical Slicing:** Each feature (`auth`, `posts`, `users`) contains all layers (controller, service, routes) for high cohesion

-  **Dependency Inversion:** Shared infrastructure lives in `shared/`; modules don't import each other directly
-  **Async Notifications:** Email and in-app notifications are queued via BullMQ to prevent blocking API responses
-  **Dual Token Auth:** Access token (15m lifetime) + refresh token (7d, stored in Redis) for security

## ⚡ Quick Start

### Prerequisites

-  **Bun** (v1.0+) or **Node.js** v18+
-  **PostgreSQL** 16+ (or use Docker)
-  **Redis** 7.2+ (or use Docker) 

### Installation

```bash
# Clone the repository
git clone https://github.com/Afzal14786/writespace.git
cd writespace

# Install dependencies
bun install

# Copy environment template
cp .env.example .env

# Start dependencies with Docker (PostgreSQL + Redis)
docker-compose up -d

# Generate and run database migrations
bun run db:generate
bun run db:migrate

# Start development server
bun run dev
``` 

### Environment Variables (.env) 

```env
PORT=5000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/writespace
REDIS_URL=redis://localhost:6379

JWT_ACCESS_SECRET=your-access-secret-key
JWT_REFRESH_SECRET=your-refresh-secret-key
JWT_ACCESS_EXPIRE=15m

AWS_ACCESS_KEY_ID=your-aws-key
AWS_SECRET_ACCESS_KEY=your-aws-secret
AWS_S3_BUCKET=writespace-uploads
AWS_REGION=us-east-1

CLIENT_URL=http://localhost:3000
SMTP_HOST=smtp.gmail.com
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

## 📁 Project Structure 
```text
writespace/
├── src/
│   ├── config/               # Global configs (env, redis, logger)
│   │   ├── env.ts            # Zod-validated environment variables
│   │   ├── redis.ts          # Redis client + BullMQ connection
│   │   └── logger.ts         # Zario structured logging
│   │
│   ├── db/                   # Database layer
│   │   ├── index.ts          # pg Pool + Drizzle ORM instance
│   │   └── schema/           # Drizzle table definitions
│   │       ├── users.ts      # users table
│   │       ├── posts.ts      # posts table
│   │       ├── comments.ts   # comments table
│   │       ├── likes.ts      # likes table (polymorphic)
│   │       ├── shares.ts     # shares tracking
│   │       ├── notifications.ts
│   │       └── relations.ts  # Drizzle relations for joins
│   │
│   ├── modules/              # Vertical slices (feature modules)
│   │   ├── auth/             # Register, login, OAuth, password reset
│   │   ├── users/            # User CRUD, profile, shareable links
│   │   ├── posts/            # Post CRUD, feed, likes, shares
│   │   ├── interactions/     # Comments, likes, shares handling
│   │   └── notification/     # Email templates & notification service
│   │
│   ├── shared/               # Cross-cutting concerns
│   │   ├── constants/        # HTTP status codes, error codes
│   │   ├── infra/            # External services (mailer, S3)
│   │   ├── middlewares/      # Auth, validation, rate limiting, uploads
│   │   ├── queues/           # BullMQ workers (email, notifications)
│   │   ├── utils/            # ApiResponse, AppError, catchAsync
│   │   └── types/            # Express type augmentations
│   │
│   ├── app.ts                # Express app setup
│   └── server.ts             # Entry point with graceful shutdown
│
├── test/                     # E2E tests with Jest + supertest
├── drizzle.config.ts         # Drizzle Kit migration config
├── docker-compose.yml        # PostgreSQL + Redis services
├── Dockerfile                # Multi-stage production build
└── package.json
```

## 🌐 API Endpoints

### 🔐 Authentication (`/api/v1/auth`)

| Method | Endpoint | Description | Auth Requirement |
| :--- | :--- | :--- | :--- |
| `POST` | `/register` | Register a new user (Rate limited) | Public |
| `POST` | `/verify-email` | Verify OTP and create account | Public |
| `POST` | `/login` | Log in and receive tokens | Public |
| `POST` | `/forgot-password` | Request password reset | Bearer |
| `POST` | `/reset-password` | Reset password via token | Public |
| `PUT` | `/update-password` | Update logged-in user's password | Bearer |
| `POST` | `/refresh-token` | Get new access token | Refresh Token |
| `POST` | `/logout` | Log out and invalidate session | Public |
| `GET` | `/google` | Initiate Google OAuth | Public |
| `GET` | `/google/callback` | Google OAuth Callback | Public |
| `GET` | `/github` | Initiate GitHub OAuth | Public |
| `GET` | `/github/callback` | GitHub OAuth Callback | Public |

### 💬 Interactions (`/api/v1/interactions`)

| Method | Endpoint | Description | Auth Requirement |
| :--- | :--- | :--- | :--- |
| `GET` | `/comments/:postId` | Get top-level comments for a post | Bearer |
| `POST` | `/comments/:postId` | Add a comment to a post | Bearer |
| `GET` | `/comments/:commentId/replies` | Fetch replies for a specific comment | Bearer |
| `POST` | `/comments/:commentId/like` | Toggle Like/Unlike on a comment | Bearer |
| `POST` | `/posts/:postId/like` | Toggle Like/Unlike on a post | Bearer |
| `PUT` | `/comments/:commentId` | Update an existing comment | Bearer |
| `DELETE` | `/comments/:commentId` | Delete a comment | Bearer |

### 🔔 Notifications (`/api/v1/notifications`)

| Method | Endpoint | Description | Auth Requirement |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Get all user notifications | Bearer |
| `PUT` | `/read` | Mark specific notification as read | Bearer |
| `PUT` | `/read-all` | Mark all notifications as read | Bearer |

### 📝 Posts (`/api/v1/posts`)

| Method | Endpoint | Description | Auth Requirement |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Get all posts (Paginated) | Bearer |
| `GET` | `/:id` | Get single post details | Bearer |
| `POST` | `/` | Create a new post (Supports Multipart/form-data) | Bearer |
| `PUT` | `/:id` | Update an existing post (Supports Multipart) | Bearer |
| `DELETE` | `/:id` | Delete a post | Bearer |
| `POST` | `/:id/like` | Like a post | Bearer |
| `POST` | `/:id/share` | Generate share link for a post | Public |

### 👥 Users (`/api/v1/users`)

| Method | Endpoint | Description | Auth Requirement |
| :--- | :--- | :--- | :--- |
| `GET` | `/check-username` | Check if a username is available | Public |
| `GET` | `/og/:username` | Get profile dynamic OpenGraph image | Public |
| `GET` | `/search` | Search users by username or fullname | Bearer |
| `GET` | `/me` | Get current authenticated user's session data | Bearer |
| `GET` | `/profile/:username` | Get public profile data (Follow stats attached if logged in) | Optional |
| `POST` | `/:id/follow` | Toggle follow/unfollow for a user | Bearer |
| `PUT` | `/:id` | Update profile fields & images (Multipart/form-data) | Owner / Admin |
| `DELETE` | `/:id` | Suspend or soft-delete account | Owner / Admin |  

*Full API documentation available at [docs.writespace.com](docs.writespace.com) (coming soon)*  

## 🧪 Testing

```bash
# Run unit tests
bun run test

# Run E2E tests (requires DB + Redis)
bun run test:e2e

# Run with coverage
bun run test:coverage
```
> Test coverage: Auth module (95%), Posts module (88%), Interactions (82%)

## 📦 Deployment  

### Docker Production Build
```bash
docker build -t writespace-api .
docker run -p 5000:5000 --env-file .env writespace-api
```

### CI/CD (GitHub Actions)
-  **On push to** `main`: Runs lint → test → build
-  **On tag push:** Builds Docker image → pushes to Docker Hub → deploys to production

### Environment Requirements
-  Node.js 18+ or Bun
-  PostgreSQL 16+ (managed RDS recommended)
-  Redis 7.2+ (ElastiCache or Upstash)
-  AWS S3 bucket for media storage

### 🤝 Contributing
We welcome contributions! Please read:  

-  [Contributing Guide](./CONTRIBUTING.md) — Code of conduct, PR process
-  [Developer Guide](./DEVELOPER.md) — Deep architecture, adding features
-  [Code Of Conduct](./CODE_OF_CONDUCT.md)  

### 📄 License
MIT © WriteSpace — see [LICENSE](./LICENSE) for details.