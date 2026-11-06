![Writespace — Local Development: environment setup, database configuration and running the backend](../assets/banners/local-development.png)

# Local Development

## Purpose

This document explains how to set up and run the Writespace backend in a local development environment.

It covers the required tools, environment configuration, dependency installation, PostgreSQL setup, Redis connectivity, database initialization, and application startup.

The objective is to make it possible for a developer to clone the repository and configure a working local environment without manually guessing the setup process.

## 1. Prerequisites

Before setting up Writespace, make sure the following tools are available.

| Tool              | Purpose                                                     |
| ----------------- | ----------------------------------------------------------- |
| Node.js           | JavaScript and TypeScript runtime.                          |
| npm               | Dependency installation and project scripts.                |
| PostgreSQL        | Persistent relational database.                             |
| Redis             | Queue infrastructure for BullMQ.                            |
| Git               | Source code management.                                     |
| Docker (optional) | Running infrastructure services locally through containers. |

Use a Node.js version compatible with the project's `package.json` and Docker configuration.

PostgreSQL is required for application persistence. Redis is required for background processing components that use BullMQ.

## 2. Clone the repository

Clone the Writespace repository:

```bash
git clone https://github.com/Afzal14786/writespace.git
```

Navigate into the project:

```bash
cd writespace
```

Switch to the branch you intend to work on when necessary:

```bash
git checkout <branch-name>
```

## 3. Install dependencies

Writespace uses npm for dependency management.

Install the dependencies from the committed lockfile:

```bash
npm ci
```

`npm ci` installs the exact dependency versions recorded in `package-lock.json`.

For ordinary dependency development, use npm commands and commit the corresponding package manifest and lockfile changes together.

## 4. Environment configuration

The project provides an example environment file:

```text
.env.example
```

Create your local environment file:

```bash
cp .env.example .env
```

Open `.env` and configure the values required by the application.

The exact environment variables and their validation rules are maintained in:

```text
src/config/env.ts
```

Environment values generally cover the following areas:

| Configuration area | Purpose                                           |
| ------------------ | ------------------------------------------------- |
| Application        | Runtime environment and server configuration.     |
| PostgreSQL         | Database connection URL.                          |
| Redis              | Redis connection configuration.                   |
| Authentication     | Authentication secrets and related configuration. |
| Email              | Email provider and mail delivery configuration.   |
| Media storage      | Media provider credentials and configuration.     |
| Logging            | Logging behavior and application diagnostics.     |

The actual variable names and required values should always be taken from `.env.example` and `src/config/env.ts`.

### Environment file security

The `.env` file contains local configuration and potentially sensitive credentials.

Follow these rules:

- Never commit `.env`.
- Never publish database credentials.
- Never expose authentication secrets.
- Do not put production credentials in example files.
- Keep `.env.example` updated whenever new required variables are introduced.
- Use separate credentials for local development and production.

## 5. PostgreSQL setup

Writespace uses PostgreSQL as its primary relational database.

The application connects to PostgreSQL through the database URL configured in:

```env
DATABASE_URL=postgresql://username:password@localhost:5432/writespace
```

Replace the sample credentials with your actual local database configuration.

### Create a local database

For a local PostgreSQL installation, create a database:

```bash
createdb writespace
```

Alternatively, use the PostgreSQL interactive shell:

```bash
psql postgres
```

Then execute:

```sql
CREATE DATABASE writespace;
```

Exit the PostgreSQL shell:

```sql
\q
```

### Verify the database connection

After configuring `DATABASE_URL`, execute:

```bash
psql "$DATABASE_URL" -c 'SELECT current_database(), current_schema();'
```

This helps confirm that the application is pointing to the intended database.

## 6. Redis setup

Redis is used by the background job infrastructure through BullMQ.

It provides the queue storage and coordination required by the application's queue producers and workers.

Redis is used for asynchronous operations rather than acting as the primary application database.

### Local Redis installation

Start your local Redis server using the appropriate service command for your operating system.

For a standard local installation, verify connectivity using:

```bash
redis-cli ping
```

A healthy Redis instance should respond:

```text
PONG
```

If Redis uses a non-default host, port, or authentication configuration, use the connection settings configured in the Writespace environment.

### Redis through Docker

Docker can also be used to run Redis locally.

Inspect the services defined in Docker Compose:

```bash
docker compose config --services
```

Start the required infrastructure services using their configured service names:

```bash
docker compose up -d
```

Check their status:

```bash
docker compose ps
```

## 7. Docker-based development

Writespace includes:

```text
Dockerfile
docker-compose.yml
.dockerignore
```

These files provide container-based application and infrastructure configuration.

Before starting the environment, inspect the Compose service configuration:

```bash
docker compose config
```

List the available services:

```bash
docker compose config --services
```

Start the configured services:

```bash
docker compose up -d
```

Check the running containers:

```bash
docker compose ps
```

View service logs:

```bash
docker compose logs -f
```

To stop the services:

```bash
docker compose down
```

Avoid using `docker compose down -v` unless you intentionally want to delete the associated Docker volumes and their persisted data.

The exact service names, ports, health checks, volumes, and startup dependencies are defined in `docker-compose.yml`.

## 8. Database initialization

Writespace uses Drizzle ORM and Drizzle Kit for schema management.

The active database schema is defined under:

```text
src/db/schema/
```

The Drizzle configuration is maintained in:

```text
drizzle.config.ts
```

There are two supported ways to initialize or synchronize a local development database.

### Option A: Apply committed migrations

For a fresh database using the committed migration baseline:

```bash
npx drizzle-kit migrate
```

This applies the generated SQL migration history to the configured database.

This is the preferred approach when validating that a fresh environment can be initialized from the migration files committed to the repository.

### Option B: Push the current schema

For local development and experimentation:

```bash
npm run db:push
```

This synchronizes the current Drizzle schema directly with the database.

It is useful when schema definitions are changing frequently and you need to update your disposable local database.

**Important:** These are alternative initialization workflows. Do not blindly run both against the same database and assume that direct schema synchronization has updated the migration history.

For more details, see [Database Migrations](../database/migrations.md).

## 9. Generate database migrations

When changing the database schema, update the relevant TypeScript schema files first.

Generate a migration:

```bash
npm run db:generate
```

Drizzle Kit compares the current schema with its migration snapshots and generates the corresponding SQL migration.

The generated files are stored inside:

```text
drizzle/
```

Review the generated SQL before applying it.

For a versioned migration workflow, apply the migration using:

```bash
npx drizzle-kit migrate
```

Do not manually delete migration history during routine development.

## 10. Run the backend application

Once the dependencies, environment, PostgreSQL, and Redis are configured, the backend can be started.

First, inspect the scripts available in `package.json`:

```bash
npm run
```

Use the development script defined in the project configuration to start the application.

The exact command should follow the current package scripts rather than assuming that every environment supports the same startup command.

### Build verification

Before starting the application, you can validate the TypeScript build:

```bash
npm run build
```

A successful build confirms that the current TypeScript source compiles.

It does not independently verify database connectivity, queue processing, or external integrations.

## 11. Verify the local environment

After starting the backend, verify the main infrastructure components.

| Component          | Verification                                                             |
| ------------------ | ------------------------------------------------------------------------ |
| PostgreSQL         | Connect using `DATABASE_URL`.                                            |
| Redis              | Confirm that Redis responds to `PING`.                                   |
| Database schema    | Confirm that the expected tables exist.                                  |
| Application        | Confirm that the backend starts successfully.                            |
| HTTP API           | Call the application's configured health endpoint, if enabled.           |
| Background workers | Confirm that their configured queue connections initialize successfully. |
| Environment        | Confirm that required variables pass validation.                         |

For PostgreSQL, a useful verification command is:

```bash
psql "$DATABASE_URL" -c '\dt'
```

This lists the tables available in the connected database.

## 12. Useful development commands

The following commands are useful during everyday development.

| Command                   | Purpose                                      |
| ------------------------- | -------------------------------------------- |
| `npm ci`                  | Install dependencies from the lockfile.      |
| `npm run`                 | List available npm scripts.                  |
| `npm run build`           | Build the backend.                           |
| `npm run db:generate`     | Generate a database migration.               |
| `npm run db:push`         | Synchronize the development database schema. |
| `npx drizzle-kit migrate` | Apply committed migrations.                  |
| `docker compose up -d`    | Start configured container services.         |
| `docker compose ps`       | Check container status.                      |
| `docker compose logs -f`  | Follow container logs.                       |
| `docker compose down`     | Stop and remove Compose containers.          |
| `psql "$DATABASE_URL"`    | Open the configured PostgreSQL database.     |
| `redis-cli ping`          | Verify local Redis connectivity.             |

## 13. Troubleshooting

### PostgreSQL connection failure

Common causes include:

- PostgreSQL is not running.
- The database does not exist.
- Incorrect credentials.
- Incorrect host or port.
- The configured database URL is not being loaded.

Check the environment configuration and verify the connection independently using `psql`.

### Redis connection failure

A Redis connection error such as:

```text
ECONNREFUSED 127.0.0.1:6379
```

means the application could not establish a connection to Redis at the configured address.

Check:

1. Whether Redis is running.
2. Whether the configured port is correct.
3. Whether the application and Redis are running in compatible network environments.
4. Whether the Redis connection configuration is being loaded correctly.

An important Docker consideration is that `127.0.0.1` inside an application container refers to that container itself, not another container running Redis. Use the appropriate Compose service hostname when connecting between containers.

### Missing environment variables

The application validates environment variables through its configuration layer.

If startup fails due to missing variables:

- Compare `.env` with `.env.example`.
- Check `src/config/env.ts`.
- Confirm the application is loading the correct environment file.
- Make sure the environment file is located in the expected working directory.

### Database schema mismatch

If the application expects a table or column that does not exist:

- Check the current Drizzle schema exports.
- Verify the migration state.
- Generate a migration when the schema has changed.
- Apply the appropriate migration or synchronize the disposable development database.

Avoid manually creating tables to work around schema mismatches.

## 14. Development practices

To keep the local development environment consistent:

1. Keep `.env.example` synchronized with required configuration.
2. Use the committed `package-lock.json` when installing dependencies.
3. Keep schema changes inside the Drizzle schema definitions.
4. Review generated migrations before applying them.
5. Do not share or commit local database credentials.
6. Avoid destructive database resets unless the database is disposable.
7. Verify PostgreSQL and Redis independently when debugging connectivity problems.
8. Run the build after making backend changes.
9. Keep local infrastructure configuration aligned with Docker Compose.
10. Verify background workers when modifying queue-related code.

## Related documentation

- [Architecture Overview](../architecture/overview.md)
- [Database Schema](../database/schema.md)
- [Database Migrations](../database/migrations.md)
- [Authentication and Users](../modules/authentication-and-users.md)
- [Notifications](../modules/notifications.md)
- [Background Jobs](background-jobs.md)
