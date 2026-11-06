# Writespace Documentation

Welcome to the technical documentation for **Writespace**.

This directory contains the engineering documentation for the Writespace backend, including its architecture, database design, application modules, and operational infrastructure.

The purpose of this documentation is to explain how the system works, why certain architectural decisions were made, and how different components interact with each other.

## Documentation Structure

The documentation is organized into four main sections.

```text
docs/
│
├── README.md
│
├── assets/
│   ├── banners/
│   └── diagrams/
│
├── architecture/
│   ├── overview.md
│   └── content-model.md
│
├── database/
│   ├── schema.md
│   └── migrations.md
│
├── modules/
│   ├── posts-and-articles.md
│   ├── interactions.md
│   ├── authentication-and-users.md
│   └── notifications.md
│
└── operations/
    ├── local-development.md
    └── background-jobs.md
```

## 1. Architecture

This section explains the high-level system design and the relationships between major components.

| Document                                          | Description                                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [Architecture Overview](architecture/overview.md) | High-level backend architecture, module responsibilities, and request processing.              |
| [Content Model](architecture/content-model.md)    | Shared content identity and the relationship between Posts, Articles, and common interactions. |

Start here when you want to understand the overall structure of Writespace before exploring individual modules.

## 2. Database

This section documents the database structure and schema management approach.

| Document                                      | Description                                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [Database Schema](database/schema.md)         | Database tables, relationships, constraints, indexes, and schema organization.                  |
| [Database Migrations](database/migrations.md) | Drizzle configuration, migration generation, database synchronization, and migration workflows. |

This section is useful when modifying database structures, introducing new entities, or investigating data relationships.

## 3. Modules

This section explains the responsibilities and internal organization of the major backend modules.

| Document                                                        | Description                                                                             |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [Posts and Articles](modules/posts-and-articles.md)             | Content creation, lifecycle, media handling, queries, and preview metadata.             |
| [Interactions](modules/interactions.md)                         | Reactions, comments, comment reactions, saves, shares, follows, and interaction events. |
| [Authentication and Users](modules/authentication-and-users.md) | Authentication workflows, OTP verification, password management, and user operations.   |
| [Notifications](modules/notifications.md)                       | Notification records, delivery tracking, and notification processing.                   |

Each module document focuses on its responsibilities and how it communicates with other parts of the application.

## 4. Operations

This section covers the infrastructure and workflows required to run and maintain the backend.

| Document                                             | Description                                                                            |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [Local Development](operations/local-development.md) | Environment setup, dependencies, PostgreSQL, Redis, Docker, and application startup.   |
| [Background Jobs](operations/background-jobs.md)     | BullMQ, Redis queues, workers, retries, failure handling, and asynchronous processing. |

Use these documents when setting up a development environment or working with background infrastructure.

## Documentation Assets

The `assets/` directory contains visual resources used throughout the documentation.

```text
assets/
│
├── banners/
│   └── Document-specific banners
│
└── diagrams/
    └── Architecture and technical diagrams
```

### Banners

Each major Markdown document should begin with a Writespace-branded banner related to its subject.

Examples include:

- Writespace Architecture
- Writespace Content Model
- Writespace Database Schema
- Writespace Interactions
- Writespace Notifications

Banners provide visual consistency and help identify the purpose of each document.

### Diagrams

Diagrams are used to explain architecture, relationships, request flows, and background processing.

Mermaid is preferred for technical diagrams because its source can be maintained alongside the documentation.

SVG and PNG images can also be included when a visual representation is more useful than an embedded diagram.

## Documentation Guidelines

To keep the documentation useful and maintainable, follow these principles:

**1. Document the actual implementation**

Documentation should reflect the current repository. Avoid describing planned features as if they already exist.

**2. Explain responsibilities**

Focus on what a module does, why it exists, and how it communicates with other components.

**3. Explain important design decisions**

When a design decision affects architecture, data consistency, scalability, or security, document the reasoning behind it.

**4. Use diagrams where they add value**

Use diagrams to explain complex relationships and workflows. Avoid adding visuals that simply repeat information already explained in text.

**5. Keep documentation organized**

Store architecture documentation under `architecture/`, database documentation under `database/`, module documentation under `modules/`, and operational documentation under `operations/`.

**6. Keep documentation updated**

Whenever an implementation changes significantly, review the related documentation and update it accordingly.

## Recommended Reading Order

For someone new to the Writespace backend, the recommended reading order is:

1. Architecture Overview
2. Content Model
3. Database Schema
4. Database Migrations
5. Posts and Articles
6. Interactions
7. Authentication and Users
8. Notifications
9. Local Development
10. Background Jobs

This order introduces the system architecture first, then explains the database and business modules before moving into operational concerns.

## Contribution and Maintenance

When introducing a new backend module or making a significant architectural change:

1. Identify which existing document needs updating.
2. Add a new document only when the subject deserves its own explanation.
3. Place related images and diagrams in the appropriate assets directory.
4. Update this README when adding or removing documentation files.
5. Ensure that documented behavior matches the implementation.

The goal is not to document every source file individually. It is to maintain a clear engineering reference that helps developers understand, operate, and extend Writespace.

---

**Writespace Engineering Documentation**

_Understanding the system. Documenting the decisions. Building for maintainability._
