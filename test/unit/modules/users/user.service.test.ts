import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { UserService } from '../../../../src/modules/users/user.service';
import { db } from '../../../../src/db';
import { AppError } from '../../../../src/shared/utils/app.error';

// 1. MOCK THE DRIZZLE DB INSTANCE
jest.mock('../../../../src/db', () => ({
  db: {
    query: {
      users: {
        findFirst: jest.fn(),
      },
    },
    // Mocking the Drizzle Fluent API chain: db.update().set().where().returning()
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    returning: jest.fn(),
  },
}));

// 2. MOCK THE NOTIFICATION SERVICE
jest.mock('../../../../src/modules/notification/notification.service', () => ({
  notificationService: {
    sendProfileUpdateEmail: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
  },
}));

describe('UserService Unit Tests', () => {
  // Clear mock history before every test to ensure isolated environments
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getUserProfile()', () => {
    it('should return a sanitized public user profile if the user exists', async () => {
      // Arrange
      const mockDbUser = {
        id: 'user-123',
        username: 'testuser',
        fullname: 'Test User',
        passwordHash: 'hashedpassword', 
        bio: 'Hello World',
      };
      
      (db.query.users.findFirst as unknown as ReturnType<typeof jest.fn>).mockResolvedValueOnce(mockDbUser);

      const result = await UserService.getUserProfile('testuser');

      // Assert
      expect(db.query.users.findFirst).toHaveBeenCalledTimes(1);
      expect(result).toHaveProperty('username', 'testuser');
      expect(result).toHaveProperty('bio', 'Hello World');
      expect(result).not.toHaveProperty('passwordHash'); 
      expect(result.isFollowingByMe).toBe(false);
    });

    it('should throw an AppError (404) if user is not found in the database', async () => {
      // Arrange
      (db.query.users.findFirst as unknown as ReturnType<typeof jest.fn>).mockResolvedValueOnce(null);

      // Act & Assert
      await expect(UserService.getUserProfile('unknown_user')).rejects.toThrow(AppError);
      await expect(UserService.getUserProfile('unknown_user')).rejects.toMatchObject({
        statusCode: 404,
        message: 'User not found'
      });
    });
  });

  describe('updateUser()', () => {
    it('should successfully update a user and return the new data', async () => {
      // Arrange
      const userId = 'user-123';
      const updateDto = { personal_info: { bio: 'Updated Bio' } };
      const updatedUser = { id: userId, username: 'testuser', bio: 'Updated Bio' };

      // Safely mock the Drizzle update chain specifically for this test
      
      const mockReturning = jest.fn<() => Promise<typeof updatedUser[]>>().mockResolvedValueOnce([updatedUser]);
      const mockWhere = jest.fn<() => { returning: typeof mockReturning }>().mockReturnValueOnce({ returning: mockReturning });
      const mockSet = jest.fn<() => { where: typeof mockWhere }>().mockReturnValueOnce({ where: mockWhere });
      
      (db.update as unknown as ReturnType<typeof jest.fn>).mockReturnValueOnce({ set: mockSet });

      // Act
      const result = await UserService.updateUser(userId, updateDto);

      // Assert
      expect(db.update).toHaveBeenCalledTimes(1);
      expect(result).toEqual(updatedUser);
    });

    it('should throw an AppError (400) if no valid fields are provided', async () => {
       // Act & Assert
       await expect(UserService.updateUser('user-123', {})).rejects.toThrow(AppError);
    });
  });
});