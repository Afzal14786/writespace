import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authService } from '../../../../src/modules/auth/auth.service';
import { db } from '../../../../src/db';
import { AppError } from '../../../../src/shared/utils/app.error';

// 1. MOCK EXTERNAL LIBRARIES
jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(),
  verify: jest.fn(),
}));

// 2. THE BULLETPROOF DRIZZLE MOCK
// Using plain arrow functions ensures Jest's auto-reset cannot destroy the query chain
jest.mock('../../../../src/db', () => {
  const mLimit = jest.fn();

  return {
    __esModule: true,
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: mLimit
          })
        })
      }),
      insert: () => ({
        values: () => ({
          returning: jest.fn()
        })
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: jest.fn()
          })
        })
      }),
      // Expose the limit mock so we can control the output data in tests
      __mockLimit: mLimit 
    },
  };
});

// 3. MOCK NOTIFICATION SERVICE
jest.mock('../../../../src/modules/notification/notification.service', () => ({
  notificationService: {
    sendLoginAlert: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    sendWelcomeEmail: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  },
}));

// 4. MOCK REDIS
jest.mock('../../../../src/config/redis', () => ({
  client: { set: jest.fn(), get: jest.fn(), del: jest.fn() },
  redisClient: { set: jest.fn(), get: jest.fn(), del: jest.fn() }
}));

describe('AuthService Unit Tests', () => {
  const MOCK_IP = '127.0.0.1';
  
  // Safely extract the exposed limit mock
  const mockLimit = (db as unknown as { __mockLimit: jest.Mock<() => Promise<unknown[]>> }).__mockLimit;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('login()', () => {
    it('should throw an AppError (401) if the user does not exist', async () => {
      // Arrange
      mockLimit.mockResolvedValueOnce([]);

      // Act & Assert
      await expect(authService.login({ email: 'wrong@mail.com', password: '123' }, MOCK_IP))
        .rejects.toThrow(AppError);
    });

    it('should throw an AppError (401) if the password is incorrect', async () => {
      // Arrange
      const mockUser = { id: '1', email: 'test@mail.com', passwordHash: 'hashed_pw', role: 'user' };
      mockLimit.mockResolvedValueOnce([mockUser]);
      
      (bcrypt.compare as jest.Mock<() => Promise<boolean>>).mockResolvedValueOnce(false);

      // Act & Assert
      await expect(authService.login({ email: 'test@mail.com', password: 'wrong' }, MOCK_IP))
        .rejects.toThrow(AppError);
    });

    it('should return tokens and user data on successful login', async () => {
      // Arrange
      const mockUser = { id: '1', username: 'testuser', email: 'test@mail.com', passwordHash: 'hashed_pw', role: 'user' };
      mockLimit.mockResolvedValueOnce([mockUser]);
      
      (bcrypt.compare as jest.Mock<() => Promise<boolean>>).mockResolvedValueOnce(true);
      (jwt.sign as jest.Mock<() => string>).mockReturnValue('mock_jwt_token');

      // Act
      const result = await authService.login({ email: 'test@mail.com', password: 'correct' }, MOCK_IP);

      // Assert
      expect(result).toHaveProperty('accessToken', 'mock_jwt_token');
      expect(result).toHaveProperty('refreshToken', 'mock_jwt_token');
      expect(result.user).toHaveProperty('username', 'testuser');
      expect(result.user).not.toHaveProperty('passwordHash'); 
    });
  });
});