# Contributing to WriteSpace

Thank you for your interest in contributing to WriteSpace! We welcome contributions from the community to help make this project better.

## 📋 Table of Contents
- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Documentation](#documentation)
- [Getting Help](#getting-help)

## Code of Conduct

This project adheres to a [Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## Getting Started

### Prerequisites
- **Bun** (v1.0+) or **Node.js** v18+
- **PostgreSQL** 16+ (or Docker)
- **Redis** 7.2+ (or Docker)
- **Git**

### Setup Development Environment

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/afzal14786/writespace.git
   cd writespace
   ```
2. **Install dependencies**
    ```bash
    bun install
    ```

3. **Set up environment variables**
    ```bash
    cp .env.example .env
    # Edit .env with your local configuration
    ```
4. **Start dependencies with Docker**
    ```bash
    docker-compose up -d
    ```
5. **Run database migrations**
    ```bash
    bun run db:generate
    bun run db:migrate
    ```
6. **Start development server**
    ```bash
    bun run dev
    ```
7. **Verify setup**
    ```bash
    curl http://localhost:5000/health
    ```

## Development Workflow  

### Branch Naming Convention
Use descriptive branch names following these patterns:  

| Type | Format | Example |
| :--- | :--- | :--- |
| **Feature** | `feature/[short-description]` | `feature/post-scheduling` |
| **Bug Fix** | `fix/[issue-number]-[description]` | `fix/42-auth-token-expiry` |
| **Documentation** | `docs/[description]` | `docs/api-authentication` |
| **Testing** | `test/[description]` | `test/notification-worker` |
| **Performance** | `perf/[description]` | `perf/query-optimization` |

### Commit Messages  
Follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification:  
```text
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**   
1. `feat:` New feature
2. `fix:` Bug fix
3. `docs:` Documentation changes
4. `style:` Code style (formatting, semicolons, etc.)
5. `refactor:` Code refactoring
6. `test:` Adding/updating tests
7. `test:` Adding/updating tests
8. `perf:` Performance improvements

**Examples:**  
```bash
feat(posts): add scheduled publishing functionality

- Add scheduled_at field to posts table
- Implement cron job to publish scheduled posts
- Add validation for future dates

Closes #123
```  
```bash
fix(auth): resolve refresh token rotation issue

Refresh tokens were not being properly invalidated after use,
causing security vulnerability. Now each refresh token can
only be used once.

Fixes #456
```

### Development Steps  

1. **Create a branch** 
    ```bash
    git checkout -b feature/your-feature-name
    ```

2. **Make changes with tests**
    * Write code following our standards
    * Add/update tests for new functionality
    * Ensure all tests pass: `bun run test`

3. **Run linter and formatter**
    ```bash
    bun run lint
    bun run format
    ```

4. **Commit your changes**
    ```bash
    git add .
    git commit -m "feat(module): description"
    ```

5. **Push to your fork**
    ```bash
    git push origin feature/your-feature-name
    ```

6. **Open a Pull Request** against the `main` branch

## Pull Request Process

### Before Submitting  
* Branch is up-to-date with `main` (`git rebase main`)
* All tests pass (`bun run test`)
* Code is linted and formatted (`bun run lint && bun run format`)
* New features have tests (unit and/or integration)
* Documentation is updated (README, API docs, comments)
* Commit messages follow conventional commits
* No merge conflicts

### PR Title Format

Use the same format as commit messages:  
```text
<type>(<scope>): <description>
```
### PR Description Template  
```markdown
## Description
[Provide a clear description of the changes]

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
[Describe how you tested your changes]

## Screenshots (if applicable)
[Add screenshots for UI changes]

## Checklist
- [ ] My code follows the project style guidelines
- [ ] I have added tests that prove my fix/feature works
- [ ] All tests pass locally
- [ ] I have updated the documentation

## Related Issues
Closes #[issue-number]
``` 

### Review Process
1. At least one maintainer must approve the PR
2. All CI checks must pass (linting, tests, build)
3. Any requested changes must be addressed
4. Squash and merge when approved (maintainer handles)

## Coding Standards

### TypeScript
* Use **strict mode** (`strict: true` in tsconfig.json)
* Explicitly type function parameters and return values
* Avoid `any` type; use `unknown` when necessary
* Use interfaces for objects, types for unions/primitives

    ```typescript
    // ✅ Good
    interface User {
    id: string;
    email: string;
    role: 'user' | 'admin';
    }

    function getUser(id: string): Promise<User | null> {
    // ...
    }

    // ❌ Bad
    function getUser(id): any {
    // ...
    }
    ```

### Error Handling
* Always use `try/catch` with `next(error)` in controllers
* Throw `AppError` instances with appropriate status codes
* Never expose stack traces in production

    ```typescript
    // ✅ Good
    async function createPost(req: Request, res: Response, next: NextFunction) {
    try {
        const result = await postService.create(req.body);
        return ApiResponse.success(res, result, 201);
    } catch (error) {
        next(error);
    }
    }

    // ❌ Bad
    async function createPost(req: Request, res: Response) {
    const result = await postService.create(req.body);
    res.json(result);
    }
    ```

### Database Operations
* Use Drizzle ORM for all database queries
* Always use parameterized queries (Drizzle handles this)
* Add appropriate indexes for new queries
* Use transactions for operations that modify multiple tables

    ```typescript
    // ✅ Good
    await db.transaction(async (tx) => {
    const [post] = await tx.insert(posts).values(data).returning();
    await tx.insert(activity).values({ postId: post.id });
    });

    // ❌ Bad
    const post = await db.insert(posts).values(data).returning();
    await db.insert(activity).values({ postId: post[0].id });
    ```

### Validation
* Define Zod schemas in `validation.ts` files
* Use `strict()` to reject unknown fields
* Validate all user inputs

    ```typescript
    // ✅ Good
    export const createPostSchema = z.object({
    title: z.string().min(3).max(255),
    content: z.object({}).passthrough(),
    status: z.enum(['draft', 'published']).default('draft'),
    }).strict();
    ```

## Testing Guidelines

### Test Structure
```text
test/
├── unit/           # Unit tests (services, utils)
├── integration/    # API endpoint tests
├── e2e/           # End-to-end user flows
└── fixtures/       # Test data
```

### Writing Tests
**Unit Test Example:**  
```typescript
// modules/posts/service.test.ts
describe('PostService', () => {
  let service: PostService;
  let mockDb: jest.Mocked<DrizzleDB>;

  beforeEach(() => {
    mockDb = { insert: jest.fn() } as any;
    service = new PostService(mockDb);
  });

  it('should create a post', async () => {
    const postData = { title: 'Test Post', content: {} };
    mockDb.insert.mockResolvedValue([{ id: '123', ...postData }]);

    const result = await service.create(postData);

    expect(result).toHaveProperty('id', '123');
    expect(mockDb.insert).toHaveBeenCalledWith(posts);
  });
});
```

**Integration Test Example:**
```typescript
// test/integration/auth.test.ts
describe('Auth API', () => {
  it('should register a new user', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'test@example.com',
        password: 'Test123!',
        name: 'Test User',
      });

    expect(response.status).toBe(201);
    expect(response.body.data.user).toHaveProperty('email', 'test@example.com');
  });
});
```

### Test Coverage
* Aim for 80% coverage for new code
* Run coverage report: `bun run test:coverage`
* Focus on critical paths: auth, payments, data integrity

## Documentation  

### Code Documentation
* Use JSDoc for public functions and classes
* Document complex logic with inline comments
* Keep comments up-to-date with code changes
    ```typescript
    /**
     * Creates a new post with optional image uploads
     * @param data - Post creation data
     * @param files - Uploaded image files (max 10, 5MB each)
     * @returns Created post with image URLs
     * @throws {AppError} If user has reached daily post limit
     */
    async function createPost(data: CreatePostDto, files?: File[]): Promise<Post>
    ```

## API Documentation
* Update the API reference when endpoints change
* Include request/response examples
* Document error codes and statuses

## README Updates
* Update README when adding major features
* Keep quick start instructions accurate
* Update badges and prerequisites

## Getting Help
### Channels
* **GitHub Issues**: For bugs and feature requests
* **Discussions**: For questions and ideas
* **Email**: [mdafzal14777@gmail.com](mailto:mdafzal14777@gmail.com) for maintainers

### Before Asking
1. Check existing issues and discussions
2. Review the [Developer Guide](./DEVELOPER.md)
3. Ensure you've followed setup instructions
4. Include relevant error messages and logs

### Reporting Bugs  
Use the bug report template:

```markdown
## Description
[Clear description of the bug]

## Steps to Reproduce
1. 
2. 
3. 

## Expected Behavior
[What should happen]

## Actual Behavior
[What actually happens]

## Environment
- OS: [e.g., macOS 14.0]
- Node/Bun version: [e.g., Bun 1.1.0]
- Database: [e.g., PostgreSQL 16]
- Redis version: [e.g., 7.2]

## Additional Context
[Screenshots, logs, etc.]
```  

**Thank you for contributing! Your efforts help make Writespace better for everyone. 🚀**  

