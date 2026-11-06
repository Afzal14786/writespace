![Writespace — Database Migrations: schema changes, migration history and database synchronization](../assets/banners/database-migrations.png)

# Database Migrations

## Purpose

This document explains how database schema changes are managed in Writespace using Drizzle ORM and Drizzle Kit.

It covers the migration configuration, how schema changes are generated, how they are applied to a database, and the difference between generating migrations and directly synchronizing a database schema.

It also documents the fresh migration baseline introduced during the shared content architecture refactoring.

The goal is to keep database changes predictable, reviewable, and consistent across development environments.

## 1. Database migration approach

Writespace uses PostgreSQL as its relational database and Drizzle ORM to define and manage the database schema.

The TypeScript schema definitions are maintained in:

```text
src/db/schema/
```

Drizzle Kit reads the active schema definitions and provides commands to:

- Generate SQL migrations from schema changes.
- Synchronize a database directly with the current schema.
- Apply generated migrations to a database.
- Maintain migration metadata and snapshots.

The general migration workflow is:

```mermaid
flowchart TD
    A[Update Drizzle schema] --> B[Generate migration]
    B --> C[Review generated SQL]
    C --> D{Choose database workflow}
    D -->|Versioned migration| E[Apply with Drizzle migrate]
    D -->|Development synchronization| F[Use Drizzle push]
    E --> G[(PostgreSQL)]
    F --> G
```

The important distinction is that generating a migration does not automatically apply it to the database.

## 2. Drizzle configuration

The Drizzle Kit configuration is maintained in the project root:

```text
drizzle.config.ts
```

Current configuration:

```ts
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

### Configuration breakdown

| Option              | Purpose                                                     |
| ------------------- | ----------------------------------------------------------- |
| `schema`            | Specifies the schema entry point Drizzle Kit reads.         |
| `out`               | Defines where generated migrations and metadata are stored. |
| `dialect`           | Specifies PostgreSQL as the database dialect.               |
| `dbCredentials.url` | Reads the database connection URL from the environment.     |

### Why use `schema/index.ts`?

The schema directory contains multiple TypeScript files, each defining a table, relation, or schema helper.

Instead of allowing Drizzle Kit to independently scan every file in the directory, the configuration points to:

```text
src/db/schema/index.ts
```

This file explicitly exports the active schema definitions.

It provides a single entry point and prevents obsolete or unused schema files from accidentally being included in migration generation.

## 3. Migration directory structure

Generated migrations and their metadata are stored inside `drizzle/`.

The directory currently follows this structure:

```text
drizzle/
│
├── 0000_tiny_gorgon.sql
│
└── meta/
    ├── 0000_snapshot.json
    └── _journal.json
```

The exact migration name may differ when generating future migrations.

### SQL migration files

Each SQL migration represents a set of database changes.

For example:

```text
0000_tiny_gorgon.sql
```

The generated SQL contains operations such as:

- Creating tables.
- Creating PostgreSQL enums.
- Adding columns.
- Creating indexes.
- Adding foreign-key constraints.
- Applying defaults and database constraints.

These files are the executable representation of the schema changes.

### Snapshot files

Snapshot files represent the schema state used by Drizzle Kit when calculating subsequent differences.

They allow Drizzle Kit to compare schema versions and determine which changes need to be generated.

Avoid manually editing snapshot files. Update the TypeScript schema definitions and let Drizzle Kit generate the corresponding metadata.

### Migration journal

The file:

```text
drizzle/meta/_journal.json
```

tracks generated migration entries and their ordering.

It is part of the migration metadata and should remain synchronized with the migration files.

Do not delete or manually reset the journal as part of ordinary schema development.

## 4. Available database commands

Writespace currently uses the following database commands:

| Command                   | Responsibility                                              |
| ------------------------- | ----------------------------------------------------------- |
| `npm run db:generate`     | Generates SQL migrations from schema changes.               |
| `npm run db:push`         | Synchronizes the database directly with the current schema. |
| `npx drizzle-kit migrate` | Applies generated migrations to the configured database.    |

The first two commands are configured through the project's npm scripts. The third is the direct Drizzle Kit CLI command.

### Generate a migration

```bash
npm run db:generate
```

This command compares the current Drizzle schema with the previously recorded schema snapshot and generates the necessary SQL migration.

The generated files are placed in:

```text
drizzle/
```

For example, when we generated the fresh baseline for the unified content architecture, Drizzle Kit reported:

```text
15 tables

users
follows
content_items
posts
articles
post_media
content_mentions
comments
content_reactions
comment_reactions
content_saves
content_shares
notifications
notification_deliveries
interaction_events
```

The generated migration was:

```text
drizzle/0000_tiny_gorgon.sql
```

**Generating a migration does not execute the SQL.** It only creates the migration files.

### Review a generated migration

Before applying a migration, inspect its contents:

```bash
cat drizzle/0000_tiny_gorgon.sql
```

For a larger migration, use:

```bash
less drizzle/0000_tiny_gorgon.sql
```

Review important operations, particularly:

- Table creation and deletion.
- Column additions and removals.
- Enum changes.
- Foreign-key constraints.
- Unique constraints.
- Index creation and deletion.
- Default values.
- Potentially destructive operations.

A migration should be reviewed before it is applied to an important database environment.

### Push the current schema

```bash
npm run db:push
```

This command connects to the configured database and synchronizes its schema directly with the current Drizzle schema.

During the recent Writespace refactoring, we used this command successfully:

```text
[✓] Pulling schema from database...
[✓] Changes applied
```

This confirmed that Drizzle Kit could synchronize the configured database with the current schema.

Unlike the generate-and-migrate workflow, `push` does not create a versioned SQL migration file for each change.

For that reason, it is useful for local development and experimentation, but it should not replace a reviewed migration workflow for shared or production environments.

### Apply generated migrations

```bash
npx drizzle-kit migrate
```

This command applies the generated migrations to the database configured in `drizzle.config.ts`.

It uses Drizzle's migration metadata to track which migrations have already been applied.

For environments that rely on migration history, this is the preferred approach.

## 5. `db:generate` vs `db:push` vs `migrate`

These commands solve different problems.

| Feature                   | `db:generate`       | `db:push`                                    | `migrate`                      |
| ------------------------- | ------------------- | -------------------------------------------- | ------------------------------ |
| Reads TypeScript schema   | Yes                 | Yes                                          | Uses generated migration files |
| Generates SQL migration   | Yes                 | No                                           | No                             |
| Directly changes database | No                  | Yes                                          | Yes                            |
| Uses migration history    | Generates metadata  | Does not apply a versioned migration history | Yes                            |
| Main purpose              | Prepare a migration | Development synchronization                  | Apply versioned migrations     |

### Workflow A: Versioned migrations

Use this workflow when database changes need to be reviewed and applied consistently across environments.

```bash
# 1. Update TypeScript schema definitions

# 2. Generate migration
npm run db:generate

# 3. Review the generated SQL and metadata

# 4. Apply the migration
npx drizzle-kit migrate

# 5. Validate the application
npm run build
```

The generated SQL and metadata should be committed to Git alongside the corresponding schema changes.

### Workflow B: Direct development synchronization

For local development or disposable databases:

```bash
# 1. Update TypeScript schema definitions

# 2. Synchronize the database
npm run db:push

# 3. Validate the application
npm run build
```

This is convenient when experimenting with schema changes without maintaining an individual migration file for every local change.

**Important:** These are alternative database-application workflows for a given schema change. Do not run `db:push` and then blindly apply the same generated migration to the same database. The database may already contain the changes, while its migration history does not reflect that they were applied through a versioned migration.

## 6. Fresh database setup

A new development environment needs a PostgreSQL database and the correct environment variables.

The database URL is configured through:

```env
DATABASE_URL=postgresql://username:password@localhost:5432/writespace
```

Use the actual credentials and database name from your local environment. Do not commit real credentials.

### Step 1: Verify the database connection

From the project root:

```bash
psql "$DATABASE_URL" -c 'SELECT current_database(), current_schema();'
```

Make sure the connection points to the intended local database.

### Step 2: Choose the initialization workflow

For a fresh database with the committed migration baseline, apply the migration:

```bash
npx drizzle-kit migrate
```

Alternatively, for a disposable local development database, synchronize directly:

```bash
npm run db:push
```

Choose one workflow for the initialization of that database.

### Step 3: Verify the application

```bash
npm run build
```

You should also check that the expected tables, constraints, and indexes exist in PostgreSQL.

## 7. Resetting a local development database

Sometimes a database needs to be completely recreated after a substantial schema refactoring.

During the Writespace content architecture refactoring, we decided to use a fresh local database setup rather than preserve the previous Post-specific table structure.

For a disposable local database, the `public` schema can be reset with:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
```

This removes all objects and data in the `public` schema.

After the reset, initialize the schema using one of the workflows described above.

**Warning:** This operation is destructive. Confirm the database name and connection target before executing it. Never run this reset command against production, staging, or a database containing data that must be retained.

Also, execute this command from your normal terminal, not inside the interactive PostgreSQL prompt.

If you are already inside `psql`, exit first:

```sql
\q
```

## 8. Fresh migration baseline introduced during the content refactoring

The previous migration history was created for the older Post-specific database architecture.

During the refactoring, Writespace introduced a shared content identity and generic interaction tables.

The new model includes:

- `content_items`
- `articles`
- `content_reactions`
- `content_saves`
- `content_shares`
- Generic content references in comments and other related entities.

Rather than continuing with the old migration chain for the fresh local database, we established a new initial migration baseline.

### What changed?

The previous migration SQL files and snapshots were removed from the working migration history.

A new initial migration was generated:

```text
drizzle/
├── 0000_tiny_gorgon.sql
└── meta/
    ├── 0000_snapshot.json
    └── _journal.json
```

The new migration represents the current schema rather than requiring a new database to replay the old Post-specific schema changes.

### Why establish a new baseline?

The purpose was to simplify initialization for a fresh database.

A developer starting with the current codebase should be able to create the current database structure without first creating obsolete tables and then applying a long sequence of transformations to reach the new model.

### Important environment consideration

This baseline reset is a development-history reset, not a safe migration strategy for an existing shared database.

An environment that has already applied the previous migrations needs a separate migration plan. It may require data migration, table transformation, counter reconciliation, foreign-key changes, and migration-history coordination.

Do not replace the migration history of an existing production or shared environment with the new baseline without planning and validating that transition separately.

## 9. Migration best practices

A few rules should be followed whenever the database schema changes.

### Keep the TypeScript schema as the source of truth

Make schema changes in the appropriate file under:

```text
src/db/schema/
```

Update `index.ts` and `relations.ts` when necessary.

Avoid treating generated SQL as the primary place to define the application's schema.

### Review generated SQL

Do not assume every generated migration is automatically safe.

Pay particular attention to:

- Dropping columns or tables.
- Changing column types.
- Adding non-null columns to populated tables.
- Changing primary keys.
- Adding foreign keys to existing data.
- Removing unique constraints.
- Renaming fields or tables.

### Consider existing data

A schema change that works on a newly created database may fail on a populated one.

For example, adding a new non-null column may require a default value or a separate data backfill before applying the constraint.

### Keep migration history in Git

Commit the generated SQL, snapshot, and journal changes together.

A developer should be able to check out the codebase and reproduce the database schema through the committed migration history.

### Keep development and production workflows separate

Use direct schema synchronization for local experimentation.

Use reviewed, versioned SQL migrations for shared environments and production deployment.

### Verify application compatibility

After applying schema changes, check the relevant repositories and services, then run:

```bash
npm run build
```

The build confirms TypeScript compatibility, but it does not replace database integration checks.

## 10. Common issues

### Error: missing `_journal.json`

Example:

```text
ENOENT: no such file or directory,
open 'drizzle/meta/_journal.json'
```

This can happen when the migration metadata directory or journal is removed while Drizzle Kit expects it to exist.

For a deliberate fresh baseline, recreate the metadata directory and initialize an empty journal before generating:

```bash
mkdir -p drizzle/meta

cat > drizzle/meta/_journal.json <<'EOF'
{
  "version": "7",
  "dialect": "postgresql",
  "entries": []
}
EOF
```

Then run:

```bash
npm run db:generate
```

This is a recovery procedure for the deliberate baseline reset, not a normal migration-generation step.

Do not delete the journal to fix ordinary migration errors.

### Error: database connection failure

Check:

- Whether PostgreSQL is running.
- Whether `DATABASE_URL` is loaded.
- Whether the database exists.
- Whether the credentials are correct.
- Whether the database is reachable from the application environment.

### Generated migration contains unexpected changes

Before applying it:

1. Check the active schema exports in `src/db/schema/index.ts`.
2. Check the configured schema entry point in `drizzle.config.ts`.
3. Inspect the generated SQL.
4. Confirm that removed tables and columns are intentional.
5. Confirm that the target database schema is the one you expect.

Do not apply a migration simply because Drizzle Kit generated it successfully.

## Related documentation

- [Architecture Overview](../architecture/overview.md)
- [Content Model](../architecture/content-model.md)
- [Database Schema](schema.md)
- [Local Development](../operations/local-development.md)
