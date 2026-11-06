<div align="center">
  <img
    src="docs/assets/banners/writespace-readme.png"
    width="100%"
    alt="Writespace — Social Blogging Platform"
  />
</div>

<h1 align="left">𝑊𝑟𝑖𝑡𝑒𝑠𝑝𝑎𝑐𝑒</h1>

<p align="center">
  <i>A Social Blogging Platform for Developers and Technical Communities.</i>
  <br />
  <i>Publish ideas, write technical articles, share knowledge, and connect with developers.</i>
</p>

<br />

<div align="center">

  <img src="https://img.shields.io/badge/TYPESCRIPT-3178C6?style=flat&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/NODE.JS-339933?style=flat&logo=nodedotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/EXPRESS-000000?style=flat&logo=express&logoColor=white" />
  <img src="https://img.shields.io/badge/POSTGRESQL-4169E1?style=flat&logo=postgresql&logoColor=white" />
  <img src="https://img.shields.io/badge/DRIZZLE_ORM-C5F74F?style=flat&logo=drizzle&logoColor=black" />
  <img src="https://img.shields.io/badge/REDIS-DC382D?style=flat&logo=redis&logoColor=white" />
  <img src="https://img.shields.io/badge/BULLMQ-EA4B71?style=flat" />
  <img src="https://img.shields.io/badge/DOCKER-2496ED?style=flat&logo=docker&logoColor=white" />

</div>

<br />

<p align="center">
  <strong><b><i>BACKEND ENGINEERING</i></b> · <b><i>CONTENT MANAGEMENT</i></b> · <b><i>SOCIAL INTERACTIONS</i></b></strong>
</p>

---

## About Writespace

Writespace is a social blogging platform designed around developers and technical communities.

The idea is to bring content creation and social interaction together in one platform. Instead of limiting users to traditional blog publishing, Writespace aims to provide an environment where developers can share short-form thoughts, publish detailed articles, connect with other developers, and participate in technical discussions.

The platform supports two primary content types:

- **Posts:** For sharing thoughts, updates, ideas, and shorter-form content.
- **Articles:** For publishing structured, long-form technical content.

Both content types are built around a shared content identity, allowing common platform features such as reactions, comments, saves, and shares to work consistently.

## Core Features

### Content Management

- Create and manage Posts.
- Create and manage long-form Articles.
- Structured content documents.
- Draft, scheduled, and published content states.
- Slug generation for Articles.
- Media attachments and cover image management.
- Social sharing preview metadata.

### Social Interactions

- Multiple reaction types.
- Commenting and threaded replies.
- Comment reactions.
- Save content for later.
- Share content across platforms.
- User follow relationships.
- Shared interaction architecture for Posts and Articles.

### Authentication and Users

- User authentication.
- OTP-based verification workflows.
- Password recovery and reset.
- User account management.
- Protected API operations.
- Request authentication and validation middleware.

### Notifications and Background Processing

- Notification management.
- Separate notification and delivery records.
- Background processing using BullMQ and Redis.
- Dedicated email, media, interaction, and notification queue infrastructure.
- Worker-based asynchronous execution.

## Architecture Highlights

### Shared Content Architecture

One of the central architectural decisions in Writespace is the use of a shared `content_items` model.

Instead of maintaining separate interaction implementations for Posts and Articles, both content types reference a common content identity.

This allows the interaction system to operate on a shared identifier while keeping content-specific fields and business rules separate.

### Modular Backend Design

The backend is organized around application modules with focused responsibilities.

Controllers handle HTTP requests, services coordinate application operations, domain logic contains content-specific rules, and repositories handle database persistence.

This separation helps keep business logic maintainable as the platform grows.

### Asynchronous Processing

Writespace uses BullMQ and Redis to process background jobs.

This allows suitable operations, such as email processing and notification-related work, to execute independently of the main HTTP request lifecycle.

### Relational Data Modeling

PostgreSQL is used as the primary database, with Drizzle ORM providing schema definitions and typed database operations.

The data model uses relationships, foreign keys, indexes, and constraints to maintain consistency across users, content, and interactions.

## Technology Stack

| Category          | Technologies |
| ----------------- | ------------ |
| Language          | TypeScript   |
| Runtime           | Node.js      |
| Backend Framework | Express      |
| Database          | PostgreSQL   |
| ORM               | Drizzle ORM  |
| Queue System      | BullMQ       |
| Queue Storage     | Redis        |
| Containerization  | Docker       |
| Schema Management | Drizzle Kit  |

## Getting Started

Writespace supports two local development workflows: running the backend directly with Node.js or running the entire development environment using Docker.

Both approaches support the same backend functionality, including PostgreSQL, Redis, background workers, and database seeding.

### Prerequisites

**For Node.js development:**

- Node.js 24+
- npm
- PostgreSQL 15+
- Redis 7+
- Git

**For Docker development:**

- Docker Desktop (or Docker Engine)
- Docker Compose V2
- Git

---

### 1. Clone the repository

```bash
git clone https://github.com/Afzal14786/writespace.git
cd writespace
```

### 2. Install dependencies

For native Node.js development, install the project dependencies:

```bash
npm install
```

This step is not required when using Docker, as dependencies are installed inside the development container.

### 3. Configure environment variables

Create your local environment file:

```bash
cp .env.example .env
```

Update the values according to your environment.

For Node.js development, configure your local PostgreSQL and Redis connection strings:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/writespace
REDIS_URL=redis://localhost:6379
```

For Docker development, the Compose configuration connects the API to the PostgreSQL and Redis services automatically. The database and Redis URLs supplied by the Compose configuration override the corresponding values from `.env`.

Make sure the remaining required application environment variables are also configured.

---

## Running with Node.js

Use this workflow when PostgreSQL and Redis are installed and running directly on your machine.

### 4. Initialize the database

First, create an empty PostgreSQL database named `writespace` and make sure PostgreSQL and Redis are running.

Choose **one** of the following database initialization approaches.

**Option A: Run migrations**

```bash
npx drizzle-kit migrate
```

This applies the committed migration files to your database.

**Option B: Synchronize the schema**

```bash
npm run db:push
```

This synchronizes the current Drizzle schema directly with the database. It is useful during local development and schema experimentation.

These are alternative initialization workflows. Do not run both as part of the same initial setup. Refer to the [Database Migrations documentation](docs/database/migrations.md) for details.

### 5. Seed the database

After initializing the schema, populate your local database with demo data:

```bash
npm run db:seed
```

The seed process populates the database with users, Posts, Articles, media, follows, mentions, comments, reactions, saves, shares, notifications, and related records.

**Important:** The seed script is intended for an empty development database. It checks whether users already exist and stops rather than inserting duplicate demo data.

### 6. Start the backend

```bash
npm run dev
```

The backend starts in development mode using Nodemon. Changes to watched source files automatically restart the application.

By default, the API is available at:

```text
http://localhost:8000
```

### 7. Build and run the application

To compile the TypeScript application:

```bash
npm run build
```

To start the compiled application:

```bash
npm start
```

---

## Running with Docker

Docker provides a complete local development environment without requiring separate PostgreSQL and Redis installations on your machine.

The development Compose configuration starts:

- Writespace API
- PostgreSQL
- Redis

### 4. Start the development environment

From the project root, run:

```bash
docker compose up --build
```

Docker builds the development image, starts the required services, and runs the backend.

The API is available at:

```text
http://localhost:8000
```

### 5. Initialize the database

On the first run, initialize the PostgreSQL database inside the API container.

Choose one of the following approaches.

**Option A: Run migrations**

```bash
docker compose exec api npx drizzle-kit migrate
```

**Option B: Synchronize the schema**

```bash
docker compose exec api npm run db:push
```

These are alternative initialization workflows.

### 6. Seed the database

Populate the Docker PostgreSQL database:

```bash
docker compose exec api npm run db:seed
```

As with native development, this should be run against an empty development database.

### 7. Development with automatic reloading and live logs

The Docker development setup mounts the local `src` directory into the API container and uses Nodemon to watch source files.

This provides:

- Automatic application restarts when watched source files change.
- No need to rebuild the Docker image for ordinary TypeScript changes.
- Live API request logs and application logs in the terminal.
- Persistent PostgreSQL and Redis data through Docker volumes.

The default `docker compose up --build` command keeps the terminal attached to the containers and displays their logs.

To follow API logs separately:

```bash
docker compose logs -f api
```

Useful Docker commands:

| Task                   | Command                        |
| ---------------------- | ------------------------------ |
| Start development      | `docker compose up --build`    |
| Start in background    | `docker compose up --build -d` |
| Follow API logs        | `docker compose logs -f api`   |
| Check running services | `docker compose ps`            |
| Stop services          | `docker compose down`          |

Changes to application source files are automatically detected. Changes to dependencies require rebuilding the development image.

---

## Production Docker Deployment

For production, Writespace uses a separate Compose configuration and a compiled Node.js application.

Configure the production environment file:

```bash
.env.production
```

Provide the required production environment variables, including valid PostgreSQL and Redis connection strings. Use managed or separately operated production database and Redis services.

Build and start the production application:

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

Follow production API logs:

```bash
docker compose -f docker-compose.prod.yml logs -f api
```

The production image runs the compiled application rather than Nodemon and does not mount the local source code.

Database migrations should be executed through the production deployment or migration process before releasing application changes. Do not run the demo seed script against a production database.

---

## Documentation

For a deeper understanding of the system architecture, database design, modules, and infrastructure, refer to the [Writespace Engineering Documentation](docs/README.md).

The documentation covers:

- Backend architecture.
- Shared content model.
- Database schema and migrations.
- Posts and Articles.
- Interactions.
- Authentication and Users.
- Notifications.
- Local development.
- Background jobs.

## Project Goals

Writespace is being developed with a focus on:

- Building a maintainable backend architecture.
- Designing reusable domain and interaction systems.
- Maintaining data consistency across related operations.
- Understanding production-oriented backend engineering.
- Improving reliability of asynchronous processing.
- Building a foundation that can support additional content types and platform capabilities.

The goal is not just to build another blogging application, but to understand and implement the engineering decisions required to build a reliable social content platform.

---

## About the Developer

<h2><em>𝓜𝓭 𝓐𝓯𝔃𝓪𝓵 𝓐𝓷𝓼𝓪𝓻𝓲</em></h2>

**Backend Developer · Competitive Programmer**

Interested in backend engineering, database systems, data structures and algorithms, and building reliable software.

### Connect with me

<a href="https://github.com/Afzal14786"><img src="https://img.shields.io/badge/GITHUB-181717?style=flat&logo=github&logoColor=white" alt="GitHub"/></a>
<a href="https://www.linkedin.com/in/0x4f5a4c/"><img src="https://img.shields.io/badge/LINKEDIN-0A66C2?style=flat&logo=linkedin&logoColor=white" alt="LinkedIn"/></a>

### Competitive Programming

<a href="https://leetcode.com/u/0x4f5a4c/"><img src="https://img.shields.io/badge/LEETCODE-FFA116?style=flat&logo=leetcode&logoColor=black" alt="LeetCode"/></a>
<a href="https://codeforces.com/profile/mdafzal14777"><img src="https://img.shields.io/badge/CODEFORCES-1F8ACB?style=flat&logo=codeforces&logoColor=white" alt="Codeforces"/></a>
<a href="https://atcoder.jp/users/iamafzal"><img src="https://img.shields.io/badge/ATCODER-222222?style=flat" alt="AtCoder"/></a>
<a href="https://www.codechef.com/users/iamafzal"><img src="https://img.shields.io/badge/CODECHEF-5B4638?style=flat" alt="CodeChef"/></a>

---

_Built with curiosity and a passion for engineering._
