import { createHash } from "node:crypto";

import type { ContentDocument } from "../../db/schema/content-document";

const UUID_NAMESPACE = Buffer.from("9c7a6e2f6e8b4c0b8f6e2a4d9c1b7a30", "hex");

export const DEMO_PASSWORD = "WritespaceDemo2026!";

export const BCRYPT_SALT_ROUNDS = 12;

/**
 * Generates a deterministic UUID from a stable seed key.
 *
 * This uses the UUID v5 namespace-based SHA-1 approach.
 * The same key always produces the same ID.
 */
export function seedUuid(key: string): string {
  const digest = createHash("sha1").update(UUID_NAMESPACE).update(key).digest();

  const bytes = Buffer.from(digest.subarray(0, 16));

  // Mark the UUID as version 5 and use the RFC 4122 variant.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export interface DemoUser {
  id: string;
  fullname: string;
  username: string;
  email: string;
  bio: string;
  headline: string;
  location: string;
  profileImageUrl: string;
  bannerImageUrl: string;
  createdAt: Date;
}

const profiles = [
  {
    fullname: "Alex Morgan",
    username: "alexmorgan",
    bio: "Backend developer exploring databases, distributed systems, and reliable software.",
    headline: "Backend Developer",
    location: "Mumbai, India",
  },
  {
    fullname: "Maya Chen",
    username: "mayachen",
    bio: "Software engineer interested in clean architecture and developer productivity.",
    headline: "Software Engineer",
    location: "Singapore",
  },
  {
    fullname: "Nina Patel",
    username: "ninapatel",
    bio: "Building applications and learning about database performance and system reliability.",
    headline: "Full-time Problem Solver",
    location: "Bengaluru, India",
  },
  {
    fullname: "Sam Wilson",
    username: "samwilson",
    bio: "Interested in asynchronous processing, queues, and backend engineering.",
    headline: "Backend Engineer",
    location: "London, UK",
  },
  {
    fullname: "Ethan Brooks",
    username: "ethanbrooks",
    bio: "Exploring cloud infrastructure, API development, and scalable systems.",
    headline: "Platform Engineer",
    location: "New York, USA",
  },
  {
    fullname: "Olivia Carter",
    username: "oliviacarter",
    bio: "Passionate about TypeScript, application security, and maintainable software.",
    headline: "Software Developer",
    location: "Toronto, Canada",
  },
  {
    fullname: "Noah Kim",
    username: "noahkim",
    bio: "Working with data systems, caching, and performance optimization.",
    headline: "Database Engineer",
    location: "Seoul, South Korea",
  },
  {
    fullname: "Priya Shah",
    username: "priyashah",
    bio: "Interested in authentication, API security, and backend architecture.",
    headline: "Application Engineer",
    location: "Pune, India",
  },
  {
    fullname: "Liam Garcia",
    username: "liamgarcia",
    bio: "Learning and writing about distributed systems and production engineering.",
    headline: "Software Engineer",
    location: "Madrid, Spain",
  },
  {
    fullname: "Zara Khan",
    username: "zarakhan",
    bio: "Exploring developer tools, testing strategies, and reliable application design.",
    headline: "Developer",
    location: "Hyderabad, India",
  },
] as const;

const bannerImages = [
  "https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=1400",
  "https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=1400",
  "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1400",
];

export const DEMO_USERS: DemoUser[] = profiles.map((profile, index) => ({
  ...profile,
  id: seedUuid(`user:${profile.username}`),
  email: `${profile.username}@writespace.test`,
  profileImageUrl: `https://api.dicebear.com/9.x/avataaars/svg?seed=${profile.username}`,
  bannerImageUrl: bannerImages[index % bannerImages.length],
  createdAt: new Date(Date.UTC(2025, 0, index + 1)),
}));

export type ContentStatus = "published" | "scheduled" | "draft";

interface BaseContentFixture {
  id: string;
  authorId: string;
  authorIndex: number;
  itemIndex: number;
  status: ContentStatus;
  scheduledAt: Date | null;
  publishDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  viewCount: number;
  contentDocument: ContentDocument;
  tags: string[];
  mentionedUserId: string;
}

export interface PostFixture extends BaseContentFixture {
  contentType: "post";
}

export interface ArticleFixture extends BaseContentFixture {
  contentType: "article";
  title: string;
  slug: string;
  subtitle: string;
  excerpt: string;
  readTime: number;
  coverImageUrl: string;
  coverImageAltText: string;
  coverImageCredit: string;
}

export type ContentFixture = PostFixture | ArticleFixture;

interface Topic {
  slug: string;
  title: string;
  subtitle: string;
  summary: string;
  explanation: string;
  practicalExample: string;
  language: string;
  code: string;
  resourceUrl: string;
  tags: string[];
  imageUrl: string;
  imageAlt: string;
}

const topics: Topic[] = [
  {
    slug: "postgresql-indexes",
    title: "Understanding PostgreSQL Indexes",
    subtitle: "Understanding how indexes influence database performance",
    summary:
      "A practical exploration of PostgreSQL indexing, query plans, and the trade-offs between read and write performance.",
    explanation:
      "Indexes help PostgreSQL locate rows without scanning an entire table. However, they consume storage and introduce additional work during inserts, updates, and deletes. Choosing an index should always be based on the queries an application actually executes.",
    practicalExample:
      "For a frequently used lookup on an email column, a B-tree index may reduce the amount of data PostgreSQL needs to scan.",
    language: "sql",
    code: "CREATE INDEX users_email_idx ON users(email);",
    resourceUrl: "https://www.postgresql.org/docs/current/indexes.html",
    tags: ["postgresql", "database", "performance"],
    imageUrl:
      "https://images.unsplash.com/photo-1518770660439-4636190af475?w=1400",
    imageAlt: "Electronic circuit board",
  },
  {
    slug: "redis-caching",
    title: "Practical Redis Caching Strategies",
    subtitle: "Understanding cache design and invalidation",
    summary:
      "An introduction to Redis caching, expiration policies, cache invalidation, and the trade-offs of keeping data in memory.",
    explanation:
      "Caching can reduce repeated database work and improve response times. The challenge is ensuring cached values remain useful when underlying data changes. Expiration, explicit invalidation, and carefully chosen cache keys all contribute to a reliable design.",
    practicalExample:
      "A profile endpoint can cache frequently requested public data for a short period while keeping account-sensitive information outside the cache.",
    language: "typescript",
    code: "await redis.set('profile:123', JSON.stringify(profile), { EX: 300 });",
    resourceUrl: "https://redis.io/docs/latest/",
    tags: ["redis", "caching", "backend"],
    imageUrl:
      "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1400",
    imageAlt: "Network servers in a data center",
  },
  {
    slug: "modular-backend",
    title: "Designing Modular Backend Applications",
    subtitle: "Keeping application responsibilities focused",
    summary:
      "A discussion about separating controllers, services, domain rules, and persistence responsibilities.",
    explanation:
      "A modular backend organizes code around related business capabilities. Each module owns its responsibilities while shared infrastructure provides common services such as logging, database access, and background processing.",
    practicalExample:
      "A content module can own content creation and publication rules while an interaction module provides reusable reactions and comments.",
    language: "typescript",
    code: "await contentService.publish(contentId, authenticatedUserId);",
    resourceUrl: "https://www.typescriptlang.org/docs/",
    tags: ["architecture", "typescript", "backend"],
    imageUrl:
      "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=1400",
    imageAlt: "Developers collaborating around a computer",
  },
  {
    slug: "background-workers",
    title: "Building Reliable Background Workers",
    subtitle: "Queues, retries, and idempotent processing",
    summary:
      "An exploration of asynchronous processing and the reliability concerns that appear when jobs can be retried.",
    explanation:
      "Background workers allow applications to execute tasks independently from HTTP requests. However, a worker can fail after performing an external side effect but before acknowledging the job. Reliable job processing must therefore consider duplicate execution and idempotency.",
    practicalExample:
      "A notification delivery job can use a stable delivery identifier to check whether the intended message has already been processed.",
    language: "typescript",
    code: "await queue.add('send-email', payload, { attempts: 3 });",
    resourceUrl: "https://docs.bullmq.io/",
    tags: ["bullmq", "redis", "reliability"],
    imageUrl:
      "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1400",
    imageAlt: "Server infrastructure",
  },
  {
    slug: "typescript-safety",
    title: "Practical Type Safety with TypeScript",
    subtitle: "Using types to make invalid states harder to represent",
    summary:
      "Understanding strict typing, unions, interfaces, and validation boundaries in TypeScript applications.",
    explanation:
      "TypeScript makes it possible to express application contracts before runtime. Discriminated unions and strict compiler settings help developers handle different data states explicitly, while runtime validation remains necessary for untrusted input.",
    practicalExample:
      "A content status union prevents a service from accidentally assigning an unsupported lifecycle state.",
    language: "typescript",
    code: "type ContentStatus = 'draft' | 'scheduled' | 'published';",
    resourceUrl:
      "https://www.typescriptlang.org/docs/handbook/2/narrowing.html",
    tags: ["typescript", "engineering", "clean-code"],
    imageUrl:
      "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=1400",
    imageAlt: "Programming workspace",
  },
  {
    slug: "authentication-security",
    title: "Designing Secure Authentication Flows",
    subtitle: "Credentials, sessions, and account recovery",
    summary:
      "A practical look at authentication boundaries, password hashing, session validation, and recovery workflows.",
    explanation:
      "Authentication establishes the identity associated with a request. A robust implementation must protect stored credentials, validate session state, limit sensitive operations, and provide safe account recovery mechanisms.",
    practicalExample:
      "A password reset flow should validate recovery authorization before changing the stored password hash.",
    language: "typescript",
    code: "const passwordHash = await bcrypt.hash(password, 12);",
    resourceUrl: "https://cheatsheetseries.owasp.org/",
    tags: ["authentication", "security", "backend"],
    imageUrl:
      "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1400",
    imageAlt: "Cybersecurity and network security illustration",
  },
  {
    slug: "cursor-pagination",
    title: "Cursor-Based Pagination Explained",
    subtitle: "Stable pagination for changing datasets",
    summary:
      "Why cursor pagination can be more reliable than offset pagination for large and frequently changing datasets.",
    explanation:
      "Offset pagination can become expensive as offsets grow and can produce inconsistent results when new records are inserted between requests. Cursor pagination uses a stable ordering and a reference to the last returned record.",
    practicalExample:
      "A feed ordered by created_at and id can use both fields as a cursor to avoid ambiguous ordering when timestamps match.",
    language: "sql",
    code: "ORDER BY created_at DESC, id DESC LIMIT 20;",
    resourceUrl: "https://www.postgresql.org/docs/current/queries-limit.html",
    tags: ["pagination", "postgresql", "api-design"],
    imageUrl:
      "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=1400",
    imageAlt: "Planning and working with information",
  },
  {
    slug: "query-optimization",
    title: "Database Query Optimization",
    subtitle: "Finding bottlenecks before adding infrastructure",
    summary:
      "An introduction to execution plans, selective indexes, and measuring database query performance.",
    explanation:
      "Query optimization starts by measuring how a database executes a query. Execution plans reveal scans, joins, and estimates that help developers identify the operations responsible for slow requests.",
    practicalExample:
      "EXPLAIN ANALYZE can help compare a query before and after adding an appropriate index.",
    language: "sql",
    code: "EXPLAIN ANALYZE SELECT * FROM users WHERE username = 'alexmorgan';",
    resourceUrl: "https://www.postgresql.org/docs/current/using-explain.html",
    tags: ["database", "performance", "sql"],
    imageUrl:
      "https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=1400",
    imageAlt: "Code displayed on a computer screen",
  },
  {
    slug: "api-reliability",
    title: "Building Reliable HTTP APIs",
    subtitle: "Validation, error handling, and predictable contracts",
    summary:
      "Exploring the responsibilities required to make API behavior consistent and understandable.",
    explanation:
      "An API is more than a collection of endpoints. Input validation, clear response contracts, authorization, observability, and failure handling all influence how reliable an API is for its consumers.",
    practicalExample:
      "A centralized error middleware can translate application errors into consistent HTTP responses.",
    language: "typescript",
    code: "throw new AppError(HTTP_STATUS.NOT_FOUND, 'Content not found');",
    resourceUrl: "https://developer.mozilla.org/en-US/docs/Web/HTTP",
    tags: ["api", "express", "backend"],
    imageUrl:
      "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1400",
    imageAlt: "Programming code",
  },
  {
    slug: "database-transactions",
    title: "Understanding Database Transactions",
    subtitle: "Atomicity and consistency in application operations",
    summary:
      "A practical introduction to transactions and why related database operations should succeed or fail together.",
    explanation:
      "A transaction groups multiple database operations into one logical unit. This is particularly important when an operation creates related records or updates counters that must remain consistent with those records.",
    practicalExample:
      "Creating a content identity and its Post subtype should happen in the same transaction so a failed subtype insert does not leave an orphaned content item.",
    language: "typescript",
    code: "await db.transaction(async (tx) => { await tx.insert(contentItems).values(row); });",
    resourceUrl:
      "https://www.postgresql.org/docs/current/tutorial-transactions.html",
    tags: ["transactions", "database", "backend"],
    imageUrl:
      "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=1400",
    imageAlt: "Developer working at a desk",
  },
];

function textNode(text: string) {
  return { type: "text" as const, text };
}

function buildPostDocument(
  topic: Topic,
  author: DemoUser,
  mentionedUserId: string,
  itemIndex: number,
): ContentDocument {
  const blocks: ContentDocument["blocks"] = [
    {
      type: "paragraph",
      children: [
        textNode(
          `I've been exploring ${topic.title.toLowerCase()} while working on backend applications. ${topic.summary}`,
        ),
      ],
    },
    {
      type: "paragraph",
      children: [
        textNode(
          `One thing that stood out to me is how much the implementation depends on understanding the real application requirements. ${topic.explanation} `,
        ),
        {
          type: "mention",
          userId: mentionedUserId,
        },
        textNode(" has also shared some useful perspectives on this topic."),
      ],
    },
    {
      type: "paragraph",
      children: [
        textNode("Useful reference: "),
        {
          type: "link",
          text: topic.title,
          url: topic.resourceUrl,
        },
        textNode(
          ". I am planning to keep experimenting with this as I build more backend features.",
        ),
      ],
    },
  ];

  // Add a small code example to selected Posts for content variety.
  if (itemIndex % 2 === 0) {
    blocks.push({
      type: "code",
      language: topic.language,
      code: topic.code,
    });
  }

  return {
    version: 1,
    blocks,
  };
}

function buildArticleDocument(
  topic: Topic,
  author: DemoUser,
  mentionedUserId: string,
): ContentDocument {
  return {
    version: 1,
    blocks: [
      {
        type: "paragraph",
        children: [
          textNode(
            `${topic.title} is an important subject for developers building modern backend applications. ${topic.summary}`,
          ),
        ],
      },
      {
        type: "paragraph",
        children: [textNode(topic.explanation)],
      },
      {
        type: "paragraph",
        children: [
          textNode(
            `A useful way to understand the concept is to look at a practical example. ${topic.practicalExample} `,
          ),
          {
            type: "mention",
            userId: mentionedUserId,
          },
          textNode(" has been exploring related engineering problems as well."),
        ],
      },
      {
        type: "code",
        language: topic.language,
        code: topic.code,
      },
      {
        type: "paragraph",
        children: [
          textNode(
            `The important takeaway is to measure the behavior of the system, understand the trade-offs, and choose an implementation that fits the actual workload. ${author.fullname} is continuing to explore this area through practical development.`,
          ),
        ],
      },
      {
        type: "paragraph",
        children: [
          textNode("Further reading: "),
          {
            type: "link",
            text: topic.title,
            url: topic.resourceUrl,
          },
        ],
      },
    ],
  };
}

function countDocumentWords(document: ContentDocument): number {
  const text = document.blocks
    .map((block) => {
      if (block.type === "code") {
        return block.code;
      }

      return block.children
        .filter((node) => node.type !== "mention")
        .map((node) => node.text)
        .join(" ");
    })
    .join(" ");

  return text.trim().split(/\s+/).filter(Boolean).length;
}

export interface BuildContentOptions {
  itemCountPerUser?: number;
}

export function buildContentFixtures(
  options: BuildContentOptions = {},
): ContentFixture[] {
  const itemCountPerUser = options.itemCountPerUser ?? 10;

  if (!Number.isInteger(itemCountPerUser) || itemCountPerUser !== 10) {
    throw new Error(
      "The initial Writespace development dataset is configured for exactly 10 content items per user.",
    );
  }

  const fixtures: ContentFixture[] = [];
  const dayInMs = 24 * 60 * 60 * 1000;
  const baseDate = Date.UTC(2026, 0, 1);

  DEMO_USERS.forEach((author, authorIndex) => {
    for (let itemIndex = 0; itemIndex < itemCountPerUser; itemIndex += 1) {
      const topic = topics[(authorIndex * 3 + itemIndex) % topics.length];
      const mentionedUser = DEMO_USERS[(authorIndex + 4) % DEMO_USERS.length];

      const id = seedUuid(`content:${author.username}:${itemIndex + 1}`);

      const createdAt = new Date(
        baseDate + (authorIndex * itemCountPerUser + itemIndex) * 2 * dayInMs,
      );

      const status: ContentStatus =
        itemIndex < 8 ? "published" : itemIndex === 8 ? "scheduled" : "draft";

      const scheduledAt =
        status === "scheduled"
          ? new Date(Date.UTC(2027, 0, 1) + authorIndex * dayInMs)
          : null;

      const publishDate =
        status === "published"
          ? new Date(createdAt.getTime() + 60 * 60 * 1000)
          : null;

      const updatedAt = publishDate ?? createdAt;

      const viewCount =
        status === "published"
          ? 80 + ((authorIndex * 43 + itemIndex * 29) % 650)
          : 0;

      const contentDocument =
        itemIndex < 6
          ? buildPostDocument(topic, author, mentionedUser.id, itemIndex)
          : buildArticleDocument(topic, author, mentionedUser.id);

      const common = {
        id,
        authorId: author.id,
        authorIndex,
        itemIndex,
        status,
        scheduledAt,
        publishDate,
        createdAt,
        updatedAt,
        viewCount,
        contentDocument,
        tags: topic.tags.slice(0, 5),
        mentionedUserId: mentionedUser.id,
      };

      if (itemIndex < 6) {
        fixtures.push({
          ...common,
          contentType: "post",
        });

        continue;
      }

      const title = `${topic.title} — ${author.fullname}`;

      fixtures.push({
        ...common,
        contentType: "article",
        title,
        slug: `${topic.slug}-${author.username}-${itemIndex + 1}`,
        subtitle: topic.subtitle,
        excerpt: topic.summary.slice(0, 250),
        readTime: Math.max(
          1,
          Math.ceil(countDocumentWords(contentDocument) / 200),
        ),
        coverImageUrl: topic.imageUrl,
        coverImageAltText: topic.imageAlt,
        coverImageCredit: "Unsplash",
      });
    }
  });

  return fixtures;
}

export const CONTENT_FIXTURES = buildContentFixtures();

export const PUBLISHED_CONTENT_FIXTURES = CONTENT_FIXTURES.filter(
  (content) => content.status === "published",
);
