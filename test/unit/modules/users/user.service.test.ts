import { userService } from '../../../../src/modules/users/user.service';
import { User } from '../../../../src/db/schema/users';
import { AppError } from '../../../../src/shared/utils/app.error';

jest.mock('../../../../src/modules/users/user.model');

describe('UserService', () => {
    describe('getUserProfile', () => {
        it('should return a user profile if user exists', async () => {
            const mockUser = {
                personal_info: { username: 'testuser' },
                getPublicProfile: jest.fn().mockReturnValue({ username: 'testuser', bio: 'Hello' })
            };
            (User.findOne as jest.Mock).mockResolvedValue(mockUser);

            const result = await userService.getUserProfile('testuser');
            expect(result).toHaveProperty('username', 'testuser');
        });

        it('should throw 404 if user not found', async () => {
            (User.findOne as jest.Mock).mockResolvedValue(null);

            await expect(userService.getUserProfile('unknown')).rejects.toThrow(AppError);
        });
    });

    describe('updateUser', () => {
        it('should update user and return new data', async () => {
            const mockUser = { _id: '123', bio: 'New Bio' };
            (User.findByIdAndUpdate as jest.Mock).mockResolvedValue(mockUser);

            const result = await userService.updateUser('123', { bio: 'New Bio' });
            expect(result).toEqual(mockUser);
        });
    });
});
