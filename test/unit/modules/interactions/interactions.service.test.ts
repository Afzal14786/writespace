import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { interactionsService } from '../../../../src/modules/interactions/interactions.service';
import { AppError } from '../../../../src/shared/utils/app.error';
import { db } from '../../../../src/db';
import { addInteractionJob } from '../../../../src/shared/queues/interaction.queue';
import { notificationService } from '../../../../src/modules/notification/notification.service';

// 1. MOCK DRIZZLE ORM OPERATORS
jest.mock('drizzle-orm', () => {
  const mockSql = () => ({ mapWith: () => ({}) });
  
  return {
    eq: jest.fn(),
    and: jest.fn(),
    desc: jest.fn(),
    lt: jest.fn(),
    isNull: jest.fn(),
    inArray: jest.fn(),
    sql: mockSql,
    relations: jest.fn(),
  };
});

// 2. THE BULLETPROOF DRIZZLE MOCK
jest.mock('../../../../src/db', () => {
  const mLimit = jest.fn<() => Promise<any[]>>().mockResolvedValue([]);
  const mReturning = jest.fn<() => Promise<any[]>>().mockResolvedValue([]);

  const mockChain = {
    from: () => mockChain,
    leftJoin: () => mockChain,
    innerJoin: () => mockChain,
    where: () => mockChain,
    orderBy: () => mockChain,
    values: () => mockChain,
    set: () => mockChain,
    limit: mLimit,
    returning: mReturning,
    execute: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
    // Makes the chain itself awaitable
    then: (resolve: any) => resolve([]),
  };

  return {
    __esModule: true,
    db: {
      select: () => mockChain,
      insert: () => mockChain,
      update: () => mockChain,
      delete: () => mockChain,
      transaction: async (cb: any) => await cb({
        select: () => mockChain,
        insert: () => mockChain,
        update: () => mockChain,
        delete: () => mockChain,
        execute: mockChain.execute,
      }),
      __mockLimit: mLimit,
      __mockReturning: mReturning,
    },
  };
});

// 3. MOCK QUEUES & EXTERNAL SERVICES
jest.mock('../../../../src/shared/queues/interaction.queue', () => ({
  addInteractionJob: jest.fn(),
}));

jest.mock('../../../../src/modules/notification/notification.service', () => ({
  notificationService: {
    sendLikeNotification: jest.fn(),
    sendShareNotification: jest.fn(),
  },
}));

jest.mock('../../../../src/config/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
}));

describe('InteractionsService Unit Tests', () => {
  const mockLimit = (db as any).__mockLimit as jest.Mock<() => Promise<any[]>>;
  const mockReturning = (db as any).__mockReturning as jest.Mock<() => Promise<any[]>>;

  const MOCK_USER_ID = 'user-123';
  const MOCK_POST_ID = 'post-123';
  const MOCK_COMMENT_ID = 'comment-123';

  beforeEach(() => {
    jest.clearAllMocks();
    
    // This ensures `.catch()` never crashes, even if Jest auto-resets mocks
    (addInteractionJob as jest.Mock).mockReturnValue(Promise.resolve());
    (notificationService.sendLikeNotification as jest.Mock).mockReturnValue(Promise.resolve());
    (notificationService.sendShareNotification as jest.Mock).mockReturnValue(Promise.resolve());

    mockLimit.mockResolvedValue([]);
    mockReturning.mockResolvedValue([]);
  });

  // Note: No afterEach(jest.restoreAllMocks) to prevent destroying our factory chains

  describe('createComment()', () => {
    it('should throw an AppError (404) if the post does not exist', async () => {
      await expect(interactionsService.createComment(MOCK_USER_ID, MOCK_POST_ID, { content: 'Hello' }))
        .rejects.toThrow(AppError);
    });

    it('should create a comment and notify the post author', async () => {
      const postAuthorId = 'author-456';
      mockLimit.mockResolvedValueOnce([{ id: MOCK_POST_ID, authorId: postAuthorId }]); 
      mockReturning.mockResolvedValueOnce([{ id: MOCK_COMMENT_ID }]); 
      mockLimit.mockResolvedValueOnce([{ id: MOCK_COMMENT_ID, content: 'Hello', author: {} }]); 

      const result = await interactionsService.createComment(MOCK_USER_ID, MOCK_POST_ID, { content: 'Hello' });

      expect(result).toHaveProperty('id', MOCK_COMMENT_ID);
      expect(addInteractionJob).toHaveBeenCalledWith(expect.objectContaining({
        recipientId: postAuthorId,
        message: 'commented on your post',
      }));
    });
  });

  describe('toggleLikePost()', () => {
    it('should add a like and notify the author if not previously liked', async () => {
      const postAuthorId = 'author-456';
      mockLimit.mockResolvedValueOnce([{ authorId: postAuthorId }]); 
      mockLimit.mockResolvedValueOnce([]); 

      const result = await interactionsService.toggleLikePost(MOCK_POST_ID, MOCK_USER_ID);

      expect(result.status).toBe('liked');
      expect(notificationService.sendLikeNotification).toHaveBeenCalledWith(postAuthorId, MOCK_USER_ID, MOCK_POST_ID);
    });

    it('should remove the like if it was previously liked without sending a notification', async () => {
      const postAuthorId = 'author-456';
      mockLimit.mockResolvedValueOnce([{ authorId: postAuthorId }]); 
      mockLimit.mockResolvedValueOnce([{ postId: MOCK_POST_ID, userId: MOCK_USER_ID }]); 

      const result = await interactionsService.toggleLikePost(MOCK_POST_ID, MOCK_USER_ID);

      expect(result.status).toBe('unliked');
      expect(notificationService.sendLikeNotification).not.toHaveBeenCalled(); 
    });
  });

  describe('deleteComment()', () => {
    it('should throw an AppError (404) if the comment does not exist', async () => {
      await expect(interactionsService.deleteComment(MOCK_USER_ID, MOCK_COMMENT_ID))
        .rejects.toThrow(AppError);
    });

    it('should throw an AppError (403) if a user tries to delete someone else\'s comment', async () => {
      mockLimit.mockResolvedValueOnce([{ id: MOCK_COMMENT_ID, authorId: 'different-user' }]);

      await expect(interactionsService.deleteComment(MOCK_USER_ID, MOCK_COMMENT_ID))
        .rejects.toThrow(AppError);
    });

    it('should allow an admin to delete someone else\'s comment', async () => {
      mockLimit.mockResolvedValueOnce([{ id: MOCK_COMMENT_ID, authorId: 'different-user', postId: MOCK_POST_ID }]);

      await interactionsService.deleteComment(MOCK_USER_ID, MOCK_COMMENT_ID, true); 
    });
  });
});