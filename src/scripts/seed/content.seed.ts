import { articles, contentItems, postMedia, posts } from "../../db/schema";

import { CONTENT_FIXTURES, seedUuid } from "./seed-data";

import type { SeedTransaction } from "./seed-types";

const POST_MEDIA_IMAGES = [
  {
    url: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200",
    altText: "Electronic circuit board",
  },
  {
    url: "https://images.unsplash.com/photo-1555949963-ff9fe0c870eb?w=1200",
    altText: "Developer working with code",
  },
  {
    url: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200",
    altText: "Programming code displayed on a screen",
  },
  {
    url: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=1200",
    altText: "Technical workspace",
  },
];

export async function seedContent(tx: SeedTransaction): Promise<void> {
  console.info("Seeding content...");

  /*
   * Step 1:
   * Create all shared content identities.
   *
   * This must happen before inserting Posts or Articles because
   * their primary keys also reference content_items.id.
   */
  const contentItemRows = CONTENT_FIXTURES.map((content) => ({
    id: content.id,
    contentType: content.contentType,

    authorId: content.authorId,
    status: content.status,

    scheduledAt: content.scheduledAt,
    publishDate: content.publishDate,

    viewCount: content.viewCount,

    // Interaction counters are recalculated after all seed modules run.
    reactionCount: 0,
    commentCount: 0,
    shareCount: 0,

    version: 1,

    createdAt: content.createdAt,
    updatedAt: content.updatedAt,
  }));

  await tx.insert(contentItems).values(contentItemRows).onConflictDoNothing({
    target: contentItems.id,
  });

  /*
   * Step 2:
   * Insert Post-specific records.
   */
  const postRows = CONTENT_FIXTURES.filter(
    (content) => content.contentType === "post",
  ).map((content) => ({
    id: content.id,
    contentDocument: content.contentDocument,
    tags: content.tags,
  }));

  await tx.insert(posts).values(postRows).onConflictDoNothing({
    target: posts.id,
  });

  /*
   * Step 3:
   * Insert Article-specific records.
   */
  const articleRows = CONTENT_FIXTURES.filter(
    (content) => content.contentType === "article",
  ).map((content) => {
    // The discriminated union guarantees Article-only properties here.
    if (content.contentType !== "article") {
      throw new Error("Invalid Article fixture");
    }

    return {
      id: content.id,

      title: content.title,
      slug: content.slug,
      subtitle: content.subtitle,

      contentDocument: content.contentDocument,
      excerpt: content.excerpt,
      tags: content.tags,
      readTime: content.readTime,

      coverImageUrl: content.coverImageUrl,
      coverImagePublicId: null,
      coverImageAltText: content.coverImageAltText,
      coverImageCredit: content.coverImageCredit,
    };
  });

  await tx.insert(articles).values(articleRows).onConflictDoNothing({
    target: articles.id,
  });

  /*
   * Step 4:
   * Create Post media attachments.
   *
   * Each Post receives one image. Posts with even item indices receive
   * an additional attachment to make the sample data more varied.
   *
   * publicId remains null because these URLs are fixture references,
   * not Cloudinary uploads.
   */
  const mediaRows = CONTENT_FIXTURES.filter(
    (content) => content.contentType === "post",
  ).flatMap((content) => {
    const attachmentCount = content.itemIndex % 2 === 0 ? 2 : 1;

    return Array.from({ length: attachmentCount }, (_, position) => {
      const image =
        POST_MEDIA_IMAGES[
          (content.authorIndex + content.itemIndex + position) %
            POST_MEDIA_IMAGES.length
        ];

      return {
        id: seedUuid(`post-media:${content.id}:${position}`),

        postId: content.id,

        url: image.url,
        publicId: null,

        position,
        altText: image.altText,

        createdAt: new Date(
          content.createdAt.getTime() + (position + 1) * 60_000,
        ),
      };
    });
  });

  await tx.insert(postMedia).values(mediaRows).onConflictDoNothing({
    target: postMedia.id,
  });

  console.info(`Content items seeded: ${contentItemRows.length}`);
  console.info(`Posts seeded: ${postRows.length}`);
  console.info(`Articles seeded: ${articleRows.length}`);
  console.info(`Post media seeded: ${mediaRows.length}`);
}
