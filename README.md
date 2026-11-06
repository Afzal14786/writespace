<div align="center">
  <img
    src="docs/assets/banners/writespace-readme.png"
    width="100%"
    alt="Writespace — Social Blogging Platform"
  />
</div>

<h1 align="left">Writespace</h1>

<p align="left">
  A Social Blogging Platform for Developers and Technical Communities.
  <br />
  Publish ideas, write technical articles, share knowledge, and connect with developers.
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
  <strong>BACKEND ENGINEERING · CONTENT MANAGEMENT · SOCIAL INTERACTIONS</strong>
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

### Prerequisites

Make sure you have the following installed:

- Node.js
- npm
- PostgreSQL
- Redis
- Git

Docker can also be used for local infrastructure setup.

### 1. Clone the repository

```bash
git clone https://github.com/Afzal14786/writespace.git
```

```bash
cd writespace
```

### 2. Install dependencies

```bash
npm ci
```

### 3. Configure environment variables

Create your local environment file:

```bash
cp .env.example .env
```

Update the environment variables according to your local configuration.

Make sure PostgreSQL and Redis connection details are configured correctly.

### 4. Initialize the database

For a fresh database using the committed migration baseline:

```bash
npx drizzle-kit migrate
```

For local development and schema experimentation, you can also synchronize the database directly:

```bash
npm run db:push
```

These are alternative initialization workflows. Refer to the [Database Migrations documentation](docs/database/migrations.md) for details.

### 5. Run the application

Check the available scripts:

```bash
npm run
```

Use the configured development script to start the backend.

### 6. Build the project

```bash
npm run build
```

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
