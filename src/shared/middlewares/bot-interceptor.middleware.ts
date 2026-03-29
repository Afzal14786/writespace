import { Request, Response, NextFunction } from 'express';
import { db } from '../../db';
import { posts } from '../../db/schema/posts';
import { users } from '../../db/schema/users';
import { eq } from 'drizzle-orm';
import logger from '../../config/logger';

export const botInterceptor = async (req: Request, res: Response, next: NextFunction) => {
  const userAgent = req.headers['user-agent']?.toLowerCase() || '';
  const postRouteMatch = req.path.match(/^\/post\/([a-zA-Z0-9-]+)/);

  if (postRouteMatch) {
    const postId = postRouteMatch[1];
    logger.debug(`[BOT-INTERCEPTOR] Hit post route for ID: ${postId} | User-Agent: ${userAgent}`);

    const isBot = userAgent.includes('twitterbot') || 
                  userAgent.includes('facebookexternalhit') || 
                  userAgent.includes('linkedinbot') || 
                  userAgent.includes('whatsapp') ||
                  userAgent.includes('skype') ||
                  userAgent.includes('telegrambot') ||
                  userAgent.includes('slackbot') ||
                  userAgent.includes('instagrambot') ||
                  userAgent.includes('redditbot') ||
                  userAgent.includes('bot') || 
                  userAgent.includes('scraper') ||
                  // 🔥 Catch headless browsers used by LinkedIn Inspector
                  userAgent.includes('mozilla/5.0 (x11; ubuntu; linux'); 

    if (isBot) {
      logger.info(`[BOT-INTERCEPTOR] 🤖 Bot Detected! Fetching post ${postId}...`);
      
      try {
        const [postData] = await db
          .select({
            title: posts.title,
            content: posts.content,
            media: posts.media,
            authorName: users.fullname,
          })
          .from(posts)
          .leftJoin(users, eq(posts.authorId, users.id))
          .where(eq(posts.id, postId))
          .limit(1);

        if (!postData) {
          logger.warn(`[BOT-INTERCEPTOR] ❌ Post ${postId} not found in DB! Falling through.`);
          return next();
        }

        logger.info(`[BOT-INTERCEPTOR] ✅ Post found! Generating HTML card for ${postId}...`);

        const rawText = postData.content?.replace(/<[^>]*>?/gm, '').trim() || 'Join the conversation on Writespace.';
        const description = rawText.length > 150 ? rawText.substring(0, 147) + '...' : rawText;
        const title = postData.title || `Post by ${postData.authorName || 'Writespace User'}`;
        
        const ogImage = postData.media && postData.media.length > 0 
          ? postData.media[0] 
          : 'https://writespace.com/default-og-image.png';

        // 🔥 FIX: Dynamically set the canonical URL to whatever domain (Pinggy or Prod) is currently running
        const currentDomain = `${req.protocol}://${req.get('host')}`;
        const canonicalUrl = `${currentDomain}/post/${postId}`;

        // 🔥 FIX: Removed JavaScript redirect so bots don't accidentally execute it and navigate away
        const html = `
          <!DOCTYPE html>
          <html lang="en">
          <head>
              <meta charset="UTF-8">
              <title>${title}</title>
              
              <meta property="og:type" content="article">
              <meta property="og:url" content="${canonicalUrl}">
              <meta property="og:title" content="${title}">
              <meta property="og:description" content="${description}">
              <meta property="og:image" content="${ogImage}">

              <meta property="twitter:card" content="summary_large_image">
              <meta property="twitter:url" content="${canonicalUrl}">
              <meta property="twitter:title" content="${title}">
              <meta property="twitter:description" content="${description}">
              <meta property="twitter:image" content="${ogImage}">
          </head>
          <body>
              <h1>${title}</h1>
              <p>${description}</p>
              <p>Please open this link in a standard browser to view the full post on Writespace.</p>
          </body>
          </html>
        `;

        res.setHeader('Bypass-Tunnel-Reminder', 'true');
        return res.status(200).send(html);

      } catch (error) {
        logger.error('[BOT-INTERCEPTOR] Database Error:', error as Error);
        return next();
      }
    } else {
      logger.debug(`[BOT-INTERCEPTOR] 👨‍💻 Human detected. Falling through to React...`);
    }
  }

  next();
};