import { asc, and, eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";

import { db } from "../../db";
import { contentItems, postMedia, posts, users } from "../../db/schema";

import type { ContentDocument } from "../../db/schema/content-document";

import logger from "@config/logger";

/**
 * Converts the structured content document into plain text for
 * social-media preview descriptions.
 *
 * Paragraphs contain text/link/mention nodes, while code blocks
 * contain their source code directly.
 */
function extractPlainText(document: ContentDocument): string {
  return document.blocks
    .map((block) => {
      if (block.type === "code") {
        return block.code;
      }

      return block.children
        .map((node) => {
          // Mentions store user IDs, not display names.
          // Avoid exposing raw IDs in the social preview.
          if (node.type === "mention") {
            return "";
          }

          return node.text;
        })
        .join("");
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export const botInterceptor = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const userAgent = req.headers["user-agent"]?.toLowerCase() || "";

  const postRouteMatch = req.path.match(/^\/post\/([a-zA-Z0-9-]+)/);
  const profileRouteMatch = req.path.match(/^\/profile\/([a-zA-Z0-9_.-]+)/);

  const isBot =
    userAgent.includes("twitterbot") ||
    userAgent.includes("facebookexternalhit") ||
    userAgent.includes("linkedinbot") ||
    userAgent.includes("whatsapp") ||
    userAgent.includes("skype") ||
    userAgent.includes("telegrambot") ||
    userAgent.includes("slackbot") ||
    userAgent.includes("instagrambot") ||
    userAgent.includes("redditbot") ||
    userAgent.includes("bot") ||
    userAgent.includes("scraper") ||
    userAgent.includes("mozilla/5.0 (x11; ubuntu; linux");

  if (postRouteMatch && isBot) {
    const postId = postRouteMatch[1];

    logger.info(
      `[BOT-INTERCEPTOR] 🤖 Bot Detected! Fetching post ${postId}...`,
    );

    try {
      const [postData] = await db
        .select({
          contentDocument: posts.contentDocument,
          authorName: users.fullname,
        })
        .from(contentItems)
        .innerJoin(posts, eq(posts.id, contentItems.id))
        .leftJoin(users, eq(contentItems.authorId, users.id))
        .where(
          and(
            eq(contentItems.id, postId),
            eq(contentItems.contentType, "post"),
            eq(contentItems.status, "published"),
          ),
        )
        .limit(1);

      // Do not generate a public preview for a missing or unpublished Post.
      if (!postData) {
        return next();
      }

      const rawText = extractPlainText(postData.contentDocument);

      const description = rawText
        ? rawText.length > 150
          ? `${rawText.substring(0, 147)}...`
          : rawText
        : "Join the conversation on Writespace.";

      // Short Posts intentionally do not have titles.
      const title = `Post by ${postData.authorName || "Writespace User"}`;

      // Post images are stored separately from the structured content body.
      const [firstMedia] = await db
        .select({
          url: postMedia.url,
        })
        .from(postMedia)
        .where(eq(postMedia.postId, postId))
        .orderBy(asc(postMedia.position))
        .limit(1);

      const ogImage =
        firstMedia?.url || "https://writespace.com/default-og-image.png";

      const currentDomain = `${req.protocol}://${req.get("host")}`;

      const html = generateOgHtml(
        title,
        description,
        ogImage,
        `${currentDomain}/post/${postId}`,
      );

      res.setHeader("Bypass-Tunnel-Reminder", "true");
      return res.status(200).send(html);
    } catch (error) {
      logger.error("[BOT-INTERCEPTOR] Post DB Error:", error as Error);
      return next();
    }
  }

  if (profileRouteMatch && isBot) {
    const username = profileRouteMatch[1];

    if (username === "me") {
      return next();
    }

    logger.info(
      `[BOT-INTERCEPTOR] 🤖 Bot Detected! Fetching profile for @${username}...`,
    );

    try {
      const [userData] = await db
        .select({
          fullname: users.fullname,
          headline: users.headline,
          bio: users.bio,
          avatar: users.profileImageUrl,
        })
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      if (!userData) {
        return next();
      }

      const title = `${userData.fullname} (@${username}) | Writespace`;

      const rawDesc =
        userData.headline ||
        userData.bio ||
        `Check out ${userData.fullname}'s portfolio, articles, and projects on Writespace.`;

      const description =
        rawDesc.length > 150 ? `${rawDesc.substring(0, 147)}...` : rawDesc;

      const ogImage =
        userData.avatar ||
        `https://ui-avatars.com/api/?name=${username}&size=512&background=random`;

      const currentDomain = `${req.protocol}://${req.get("host")}`;

      const html = generateOgHtml(
        title,
        description,
        ogImage,
        `${currentDomain}/profile/${username}`,
      );

      res.setHeader("Bypass-Tunnel-Reminder", "true");
      return res.status(200).send(html);
    } catch (error) {
      logger.error("[BOT-INTERCEPTOR] Profile DB Error:", error as Error);
      return next();
    }
  }

  next();
};

/**
 * Escapes HTML special characters before inserting user-generated
 * content into the metadata document.
 */
const escapeHtml = (value: string): string => {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  return value.replace(/[&<>"']/g, (character) => entities[character]);
};

/**
 * Generates the HTML document consumed by social-media crawlers.
 */
function generateOgHtml(
  title: string,
  description: string,
  image: string,
  url: string,
): string {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeImage = escapeHtml(image);
  const safeUrl = escapeHtml(url);

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>${safeTitle}</title>
        <meta property="og:type" content="profile">
        <meta property="og:url" content="${safeUrl}">
        <meta property="og:title" content="${safeTitle}">
        <meta property="og:description" content="${safeDescription}">
        <meta property="og:image" content="${safeImage}">
        <meta property="twitter:card" content="summary_large_image">
        <meta property="twitter:url" content="${safeUrl}">
        <meta property="twitter:title" content="${safeTitle}">
        <meta property="twitter:description" content="${safeDescription}">
        <meta property="twitter:image" content="${safeImage}">
      </head>
      <body>
        <h1>${safeTitle}</h1>
        <p>${safeDescription}</p>
        <p>Please open this link in a standard browser to view the full content on Writespace.</p>
      </body>
    </html>
  `;
}
