import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodIssue } from 'zod';
import { errorHandler } from '../../../../src/shared/middlewares/error.middleware';
import { AppError } from '../../../../src/shared/utils/app.error';

jest.mock('../../../../src/config/logger', () => {
  return {
    __esModule: true,
    default: {
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn()
    }
  };
});

describe('Global Error Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = {};
    mockRes = {
      status: jest.fn().mockReturnThis() as unknown as Response['status'],
      json: jest.fn() as unknown as Response['json'],
    };
    mockNext = jest.fn() as unknown as NextFunction;
  });

  it('should format a standard AppError correctly', () => {
    const error = new AppError(403, 'Forbidden action');
    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Forbidden action' })
    );
  });

  it('should extract and format Zod validation errors', () => {
    const mockZodIssues: ZodIssue[] = [
      { code: 'custom', path: ['email'], message: 'Invalid email format' }
    ];
    const error = new ZodError(mockZodIssues);
    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(400); 
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'email: Invalid email format' })
    );
  });

  it('should catch PostgreSQL duplicate key errors (23505) and return 409 Conflict', () => {
    const pgError = new Error('DB Error');
    Object.assign(pgError, { code: '23505', detail: 'Key (username)=(afzal) already exists.' });
    errorHandler(pgError, mockReq as Request, mockRes as Response, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(409);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Duplicate value for username' })
    );
  });
});