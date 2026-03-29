import { Request, Response, NextFunction } from 'express';
import { db } from '../../db';
import { posts } from '../../db/schema/posts';
import { users } from '../../db/schema/users';
import { eq } from 'drizzle-orm';
import logger from '../../config/logger';

export const botInterceptor = async (req: Request, res: Response, next: NextFunction) => {
  const userAgent = req.headers['user-agent']?.toLowerCase() || '';
  
  const postRouteMatch = req.path.match(/^\/post\/([a-zA-Z0-9-]+)/);
  const profileRouteMatch = req.path.match(/^\/profile\/([a-zA-Z0-9_.-]+)/);

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
                userAgent.includes('mozilla/5.0 (x11; ubuntu; linux'); 


  if (postRouteMatch) {
    const postId = postRouteMatch[1];
    if (isBot) {
      logger.info(`[BOT-INTERCEPTOR] 🤖 Bot Detected! Fetching post ${postId}...`);
      try {
        const [postData] = await db
          .select({ title: posts.title, content: posts.content, media: posts.media, authorName: users.fullname })
          .from(posts).leftJoin(users, eq(posts.authorId, users.id)).where(eq(posts.id, postId)).limit(1);

        if (!postData) return next();

        const rawText = postData.content?.replace(/<[^>]*>?/gm, '').trim() || 'Join the conversation on Writespace.';
        const description = rawText.length > 150 ? rawText.substring(0, 147) + '...' : rawText;
        const title = postData.title || `Post by ${postData.authorName || 'Writespace User'}`;
        const ogImage = postData.media && postData.media.length > 0 ? postData.media[0] : 'https://writespace.com/default-og-image.png';
        const currentDomain = `${req.protocol}://${req.get('host')}`;

        const html = generateOgHtml(title, description, ogImage, `${currentDomain}/post/${postId}`);
        res.setHeader('Bypass-Tunnel-Reminder', 'true');
        return res.status(200).send(html);
      } catch (error) {
        logger.error('[BOT-INTERCEPTOR] Post DB Error:', error as Error);
        return next();
      }
    }
  }


  else if (profileRouteMatch) {
    const username = profileRouteMatch[1];
    if (username === 'me') return next(); 

    if (isBot) {
      logger.info(`[BOT-INTERCEPTOR] 🤖 Bot Detected! Fetching profile for @${username}...`);
      try {
        const [userData] = await db
          .select({ fullname: users.fullname, headline: users.headline, bio: users.bio, avatar: users.profileImageUrl })
          .from(users).where(eq(users.username, username)).limit(1);

        if (!userData) return next();

        const title = `${userData.fullname} (@${username}) | Writespace`;
        const rawDesc = userData.headline || userData.bio || `Check out ${userData.fullname}'s portfolio, articles, and projects on Writespace.`;
        const description = rawDesc.length > 150 ? rawDesc.substring(0, 147) + '...' : rawDesc;
        const ogImage = userData.avatar || `https://ui-avatars.com/api/?name=${username}&size=512&background=random`;
        const currentDomain = `${req.protocol}://${req.get('host')}`;

        const html = generateOgHtml(title, description, ogImage, `${currentDomain}/profile/${username}`);
        res.setHeader('Bypass-Tunnel-Reminder', 'true');
        return res.status(200).send(html);
      } catch (error) {
        logger.error('[BOT-INTERCEPTOR] Profile DB Error:', error as Error);
        return next();
      }
    }
  }

  next();
};

/**
 * Helper function to keep the HTML template clean and reusable
 */
function generateOgHtml(title: string, description: string, image: string, url: string) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>${title}</title>
        <meta property="og:type" content="profile">
        <meta property="og:url" content="${url}">
        <meta property="og:title" content="${title}">
        <meta property="og:description" content="${description}">
        <meta property="og:image" content="${image}">
        <meta property="twitter:card" content="summary_large_image">
        <meta property="twitter:url" content="${url}">
        <meta property="twitter:title" content="${title}">
        <meta property="twitter:description" content="${description}">
        <meta property="twitter:image" content="${image}">
    </head>
    <body>
        <h1>${title}</h1>
        <p>${description}</p>
        <p>Please open this link in a standard browser to view the full profile on Writespace.</p>
    </body>
    </html>
  `;
}