# Security Policy

## Supported Versions

We release patches for security vulnerabilities. Here are the versions currently
receiving security updates:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | ✅ Active development |
| < 1.0   | ❌ No longer supported |

## Reporting a Vulnerability

We take security seriously at WriteSpace. If you discover a security
vulnerability, please follow these steps:

### Private Reporting (Preferred)

**DO NOT** report security vulnerabilities through public GitHub issues.

Instead, please send an email to **security@writespace.com** with:

- **Subject**: `[SECURITY] Brief description of the issue`
- **Description**: Detailed explanation of the vulnerability
- **Steps to Reproduce**: Clear, step-by-step instructions
- **Impact**: What an attacker could potentially do
- **Environment**: Versions, configurations, etc.
- **Proof of Concept**: If possible, include a minimal PoC

### What to Expect

1. **Acknowledgement**: You'll receive an acknowledgement within 48 hours
2. **Investigation**: We'll investigate and confirm the issue within 5 business days
3. **Fix**: We'll develop and test a fix
4. **Release**: We'll release a patch and credit you (unless you prefer anonymity)
5. **Disclosure**: We'll publish a security advisory after the fix is released

### Bug Bounty

We currently do not offer a bug bounty program, but we're grateful to
researchers who responsibly disclose vulnerabilities. We'll publicly
acknowledge your contribution in the security advisory.

## Security Measures

WriteSpace implements the following security practices:

### Authentication & Authorization
- **JWT tokens** with short-lived access tokens (15 minutes)
- **Refresh token rotation** to prevent token theft
- **bcrypt** password hashing (10 rounds)
- **Role-based access control** (user/admin)
- **Rate limiting**: 100 requests per 15 minutes per IP

### Data Protection
- **All sensitive data** encrypted at rest (database)
- **TLS/HTTPS** required in production
- **Input validation** with Zod schemas
- **SQL injection** prevention via Drizzle ORM
- **XSS protection** with content sanitization

### Infrastructure
- **Environment variables** for secrets (never hardcoded)
- **Helmet.js** for security headers
- **CORS** with whitelisted origins
- **AWS S3** with least-privilege IAM policies
- **Docker** container isolation

### Monitoring & Logging
- **Structured logging** with Zario
- **No sensitive data** in logs (passwords, tokens)
- **Error tracking** (planned: Sentry integration)

## Security Best Practices for Contributors

When contributing to WriteSpace, please follow these security guidelines:

### Code Reviews
- Always review authentication and authorization logic
- Check for proper input validation on user inputs
- Ensure error messages don't leak sensitive information

### Environment Variables
- Never commit `.env` files
- Use `.env.example` for documentation
- Keep secrets out of logs and error messages

### Dependencies
- Run `bun audit` regularly to check for vulnerabilities
- Update dependencies promptly when security patches are released
- Review new dependencies before adding them

### Testing
- Write tests that cover security-critical paths
- Test edge cases (malformed inputs, auth bypass attempts)
- Use the test database, never production data

## Known Vulnerabilities

We maintain a list of known vulnerabilities (with patches) in our
[GitHub Security Advisories](https://github.com/Afzal14786/writespace/security/advisories).

## Responsible Disclosure

We believe in responsible disclosure. If you find a vulnerability:

1. **Report privately** via email (not GitHub issues)
2. **Give us time** to fix the issue before public disclosure
3. **Don't exploit** the vulnerability beyond necessary proof
4. **Keep details confidential** until a fix is released

We'll work with you to validate and address the issue as quickly as possible.

---

**Security is a shared responsibility.** Thank you for helping keep
WriteSpace and its users safe. 🔒