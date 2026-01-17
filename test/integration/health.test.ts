import request from 'supertest';
import app from '../../src/app';

// Mock DB connection to avoid hanging
jest.mock('../../src/config/db', () => jest.fn());
jest.mock('../../src/config/redis', () => ({ connectRedis: jest.fn() }));

describe('Health Check Integration', () => {
    it('should return 404 for unknown routes', async () => {
        const res = await request(app).get('/api/unknown-route');
        expect(res.status).toBe(404);
    });
});
