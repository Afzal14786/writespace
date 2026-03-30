import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { notificationService } from '../../../../src/modules/notification/notification.service';
import { db } from '../../../../src/db';
import { addEmailJob } from '../../../../src/shared/queues/email.queue';
import { addInteractionJob } from '../../../../src/shared/queues/interaction.queue';
import { NotificationType } from '../../../../src/modules/notification/interface/notification.interface';

// 1. MOCK BULLMQ QUEUES
jest.mock('../../../../src/shared/queues/email.queue', () => ({
  addEmailJob: jest.fn(),
}));

jest.mock('../../../../src/shared/queues/interaction.queue', () => ({
  addInteractionJob: jest.fn(),
}));

// 2. MOCK DRIZZLE ORM OPERATORS
jest.mock('drizzle-orm', () => {
  const mockSql = () => ({ mapWith: () => ({}) });
  return {
    eq: jest.fn(),
    and: jest.fn(),
    desc: jest.fn(),
    lt: jest.fn(),
    count: jest.fn(),
    inArray: jest.fn(),
    sql: mockSql,
    relations: jest.fn(),
  };
});

// 3. THE BULLETPROOF DRIZZLE MOCK (All queries funnel into `then`)
jest.mock('../../../../src/db', () => {
  const mThen = jest.fn((resolve: any) => resolve([]));

  const mockChain = {
    select: () => mockChain,
    from: () => mockChain,
    leftJoin: () => mockChain,
    innerJoin: () => mockChain,
    where: () => mockChain,
    orderBy: () => mockChain,
    values: () => mockChain,
    set: () => mockChain,
    limit: () => mockChain,
    offset: () => mockChain,
    returning: () => mockChain,
    execute: () => mockChain,
    then: mThen, 
  };

  return {
    __esModule: true,
    db: {
      select: () => mockChain,
      insert: () => mockChain,
      update: () => mockChain,
      delete: () => mockChain,
      __mockThen: mThen,
    },
  };
});

jest.mock('../../../../src/config/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
}));

describe('NotificationService Unit Tests', () => {
  const mockThen = (db as any).__mockThen as jest.Mock<any>;
  
  const MOCK_USER_ID = 'user-123';
  const MOCK_ACTOR_ID = 'actor-456';
  const MOCK_POST_ID = 'post-789';

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Ensure safe fallbacks for queues and db mocks
    (addEmailJob as jest.Mock).mockResolvedValue(undefined as never);
    (addInteractionJob as jest.Mock).mockResolvedValue(undefined as never);
    mockThen.mockImplementation((resolve: any) => resolve([]));
  });

  // --- SECTION 1: EMAIL NOTIFICATIONS (BullMQ) ---
  describe('Email Notifications (BullMQ)', () => {
    it('should queue a welcome email', async () => {
      await notificationService.sendWelcomeEmail('test@mail.com', 'testuser', MOCK_USER_ID);

      expect(addEmailJob).toHaveBeenCalledWith(expect.objectContaining({
        to: 'test@mail.com',
        subject: 'Welcome to Writespace!'
      }));
    });

    it('should queue a password reset email', async () => {
      await notificationService.sendPasswordResetEmail('test@mail.com', 'testuser', 'http://localhost/reset');

      expect(addEmailJob).toHaveBeenCalledWith(expect.objectContaining({
        to: 'test@mail.com',
        subject: 'Reset Your Password'
      }));
    });

    it('should queue an OTP verification email', async () => {
      await notificationService.sendOtpEmail('test@mail.com', '123456');

      expect(addEmailJob).toHaveBeenCalledWith(expect.objectContaining({
        to: 'test@mail.com',
        subject: 'Verify Your Account - OTP'
      }));
    });
  });

  // --- SECTION 2: IN-APP NOTIFICATIONS (PostgreSQL & Queues) ---
  describe('In-App Notifications (Job Queuing)', () => {
    it('should queue a Like interaction job', async () => {
      await notificationService.sendLikeNotification(MOCK_USER_ID, MOCK_ACTOR_ID, MOCK_POST_ID);
      
      expect(addInteractionJob).toHaveBeenCalledWith(expect.objectContaining({
        recipientId: MOCK_USER_ID,
        type: NotificationType.LIKE
      }));
    });

    it('should queue a Comment interaction job', async () => {
      await notificationService.sendCommentNotification(MOCK_USER_ID, MOCK_ACTOR_ID, MOCK_POST_ID, 'comment-123');
      expect(addInteractionJob).toHaveBeenCalledWith(expect.objectContaining({
        type: NotificationType.COMMENT
      }));
    });

    it('should queue a Follow interaction job', async () => {
      await notificationService.sendFollowNotification(MOCK_USER_ID, MOCK_ACTOR_ID);
      expect(addInteractionJob).toHaveBeenCalledWith(expect.objectContaining({
        type: NotificationType.FOLLOW
      }));
    });
  });

  // --- SECTION 3: FETCHING & UPDATING ---
  describe('Notification Retrieval & Management', () => {
    it('should fetch paginated user notifications and the correct unread count', async () => {
      // Arrange
      const mockDbNotifications = [
        { 
          id: 1, 
          type: NotificationType.LIKE, 
          isRead: false, 
          actorId: 'actor-123',
          actorUsername: 'testuser' 
        }
      ];
      
      mockThen
        .mockImplementationOnce((resolve: any) => resolve(mockDbNotifications))
        .mockImplementationOnce((resolve: any) => resolve([{ count: 5 }]));

      // Act
      const result = await notificationService.getUserNotifications(MOCK_USER_ID, 10);

      // Assert
      expect(result.notifications).toHaveLength(1);
      expect(result.notifications[0].actor).not.toBeNull();
      expect(result.notifications[0].actor).toHaveProperty('username', 'testuser');
      expect(result.unreadCount).toBe(5); 
    });

    it('should gracefully mark specific notifications as read', async () => {
      await notificationService.markAsRead([1, 2, 3], MOCK_USER_ID);
      expect(mockThen).toHaveBeenCalled(); 
    });

    it('should gracefully mark all notifications as read', async () => {
      await notificationService.markAllAsRead(MOCK_USER_ID);
      expect(mockThen).toHaveBeenCalled();
    });
  });
});