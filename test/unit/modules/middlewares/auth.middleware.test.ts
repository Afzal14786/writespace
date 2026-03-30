import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate, authorize } from '../../../../src/shared/middlewares/auth.middleware';

describe('Auth Middlewares', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRes = {
      status: jest.fn().mockReturnThis() as unknown as Response['status'],
      json: jest.fn() as unknown as Response['json'],
    };
    mockNext = jest.fn() as unknown as NextFunction;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('authenticate()', () => {
    it('should call next() with 401 Error if no token is provided in headers', async () => {
      // Arrange
      mockReq = { headers: {} };

      // Act
      await authenticate(mockReq as Request, mockRes as Response, mockNext);

      // Assert
      expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('should attach user to request and call next() if Bearer token is valid', async () => {
      // Arrange
      const mockDecodedToken = { id: '123', role: 'user' };
      mockReq = { headers: { authorization: 'Bearer valid_token' } };
      
      const verifySpy = jest.spyOn(jwt, 'verify').mockReturnValueOnce(mockDecodedToken as any);

      // Act
      await authenticate(mockReq as Request, mockRes as Response, mockNext);

      // Assert
      expect(verifySpy).toHaveBeenCalledWith('valid_token', expect.any(String));
      expect((mockReq as Request).user).toEqual(mockDecodedToken);
      expect(mockNext).toHaveBeenCalledWith(); // Called successfully
    });
  });

  describe('authorize()', () => {
    it('should block access (403) if user role does not match allowed roles', () => {
      // Arrange (User is just a 'user')
      mockReq = { user: { id: '1', role: 'user' } };
      const middleware = authorize('admin'); // Only admins allowed

      // Act
      middleware(mockReq as Request, mockRes as Response, mockNext);

      // Assert
      expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    });

    it('should allow access and call next() if user has the required role', () => {
      // Arrange
      mockReq = { user: { id: '1', role: 'admin' } };
      const middleware = authorize('admin', 'moderator');

      // Act
      middleware(mockReq as Request, mockRes as Response, mockNext);

      // Assert
      expect(mockNext).toHaveBeenCalledWith(); // Passes through successfully
    });
  });
});