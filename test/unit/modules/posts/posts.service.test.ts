import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { postService } from '../../../../src/modules/posts/posts.service';
import { AppError } from '../../../../src/shared/utils/app.error';
import { db } from '../../../../src/db';
import { addMediaCleanupJob } from '../../../../src/shared/queues/media.queue';
import { interactionsService } from '../../../../src/modules/interactions/interactions.service';

// 1. MOCK EXTERNAL UTILITIES
jest.mock('sanitize-html', () => ({
  __esModule: true,
  default: jest.fn((input: string) => input), 
}));

jest.mock('slugify', () => ({
  __esModule: true,
  default: jest.fn(() => 'mock-slug'),
}));

// 2. MOCK DRIZZLE ORM OPERATORS
jest.mock('drizzle-orm', () => ({
  eq: jest.fn(),
  and: jest.fn(),
  desc: jest.fn(),
  lt: jest.fn(),
  inArray: jest.fn(),
  sql: jest.fn().mockReturnValue({ mapWith: jest.fn() }),
  relations: jest.fn(), 
}));

// 3. THE RECURSIVE "BULLETPROOF" DRIZZLE MOCK
jest.mock('../../../../src/db', () => {
  const mLimit = jest.fn<() => Promise<any[]>>().mockResolvedValue([]);
  const mReturning = jest.fn<() => Promise<any[]>>().mockResolvedValue([]);

  const mockChain = {
    from: () => mockChain,
    leftJoin: () => mockChain,
    where: () => mockChain,
    orderBy: () => mockChain,
    values: () => mockChain,
    set: () => mockChain,
    limit: mLimit,
    returning: mReturning,
    then: (resolve: any) => resolve([]),
  };

  return {
    __esModule: true,
    db: {
      select: () => mockChain,
      insert: () => mockChain,
      update: () => mockChain,
      delete: () => mockChain,
      transaction: jest.fn(async (cb: any) => await cb({
        insert: () => mockChain,
        update: () => mockChain,
        select: () => mockChain,
        delete: () => mockChain,
      })),
      __mockLimit: mLimit,
      __mockReturning: mReturning,
    },
  };
});

// 4. MOCK QUEUES & EXTERNAL SERVICES
jest.mock('../../../../src/shared/queues/media.queue', () => ({
  addMediaCleanupJob: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

jest.mock('../../../../src/shared/queues/interaction.queue', () => ({
  addInteractionJob: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

jest.mock('../../../../src/modules/interactions/interactions.service', () => ({
  interactionsService: {
    logShare: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  },
}));

describe('PostService Unit Tests', () => {
  // Safely extract our mock endpoints
  const mockLimit = (db as any).__mockLimit as jest.Mock<() => Promise<any[]>>;
  const mockReturning = (db as any).__mockReturning as jest.Mock<() => Promise<any[]>>;

  const MOCK_USER_ID = 'user-123';
  const MOCK_POST_ID = 'post-123';

  beforeEach(() => {
    jest.clearAllMocks();
    // Ensure fallbacks are active before every test
    mockLimit.mockResolvedValue([]);
    mockReturning.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('updatePost()', () => {
    it('should throw an AppError (404) if the post does not exist', async () => {
      // Arrange
      mockLimit.mockResolvedValueOnce([]); 

      // Act & Assert
      await expect(postService.updatePost(MOCK_POST_ID, MOCK_USER_ID, { title: 'New Title' }))
        .rejects.toThrow(AppError);
    });

    it('should throw an AppError (403) if a user tries to edit someone else\'s post', async () => {
      // Arrange
      const maliciousUserId = 'malicious-hacker-456';
      mockLimit.mockResolvedValueOnce([{ id: MOCK_POST_ID, authorId: MOCK_USER_ID }]); 

      // Act & Assert
      await expect(postService.updatePost(MOCK_POST_ID, maliciousUserId, { title: 'Hacked Title' }))
        .rejects.toThrow(AppError);
    });

    it('should update the post successfully if authorized', async () => {
      // Arrange
      // Call 1: Fetch the post to check ownership
      mockLimit.mockResolvedValueOnce([{ id: MOCK_POST_ID, authorId: MOCK_USER_ID, title: 'Old Title' }]);
      
      // Call 2: Inside generateUniqueSlug. Returning [] means the slug is totally unique!
      mockLimit.mockResolvedValueOnce([]); 
      
      const getPostSpy = jest.spyOn(postService, 'getPost').mockResolvedValueOnce({ id: MOCK_POST_ID, title: 'New Title' } as any);

      // Act
      const result = await postService.updatePost(MOCK_POST_ID, MOCK_USER_ID, { title: 'New Title' });

      // Assert
      expect(getPostSpy).toHaveBeenCalledWith(MOCK_POST_ID, MOCK_USER_ID);
      expect(result).toHaveProperty('title', 'New Title');
    });
  });

  describe('deletePost()', () => {
    it('should throw an AppError (403) if an unauthorized user tries to delete a post', async () => {
      // Arrange
      const maliciousUserId = 'malicious-hacker-456';
      mockLimit.mockResolvedValueOnce([{ id: MOCK_POST_ID, authorId: MOCK_USER_ID }]); 

      // Act & Assert
      await expect(postService.deletePost(MOCK_POST_ID, maliciousUserId))
        .rejects.toThrow(AppError);
    });

    it('should soft-delete the post and queue media cleanup jobs if authorized', async () => {
      // Arrange
      const postWithMedia = { 
        id: MOCK_POST_ID, 
        authorId: MOCK_USER_ID, 
        coverImageUrl: 'cover.jpg', 
        media: ['img1.jpg', 'img2.jpg'] 
      };
      mockLimit.mockResolvedValueOnce([postWithMedia]);

      // Act
      await postService.deletePost(MOCK_POST_ID, MOCK_USER_ID);

      // Assert
      expect(addMediaCleanupJob).toHaveBeenCalledWith(['cover.jpg', 'img1.jpg', 'img2.jpg']);
      expect(db.transaction).toHaveBeenCalled(); 
    });
  });

  describe('sharePost()', () => {
    it('should increment share count, log interaction, and return correct social URL', async () => {
      // Arrange
      mockReturning.mockResolvedValueOnce([{ slug: 'my-post', title: 'My Post' }]);

      // Act
      const result = await postService.sharePost(MOCK_POST_ID, MOCK_USER_ID, 'twitter');

      // Assert
      expect(result.platform).toBe('twitter');
      expect(result.url).toContain('https://twitter.com/intent/tweet');
      expect(interactionsService.logShare).toHaveBeenCalledWith(MOCK_USER_ID, MOCK_POST_ID, 'twitter');
    });
  });
});