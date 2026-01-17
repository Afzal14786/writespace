# Developer Documentation

## Project Overview
This is the backend service for the application, built with Node.js, Express, and TypeScript. It includes authentication, file handling, and API documentation.

## Prerequisites
- Node.js (v18+ recommended)
- npm or yarn

## Setup
1. **Install dependencies:**
   ```bash
   npm install
   ```
2. **Environment Variables:**
   Copy `.env.example` (if available) or ensure `.env` is set up with necessary keys (DB, Auth secrets).

## Scripts
- `npm start`: Run the production server (dist/server.js).
- `npm run dev`: Run the development server with nodemon.
- `npm run build`: Compile TypeScript to JavaScript in `dist/`.
- `npm test`: Run tests using Jest.
- `npm run lint`: Run ESLint.
- `npm run docs`: Generate Swagger documentation (outputs to `dist/swagger.json`).

## Project Structure
- `src/config`: Configuration files (DB, Swagger, etc.).
- `src/modules`: Feature-based modules (Controllers, Services, Models).
- `src/shared`: Shared utilities, middlewares, and types.
- `src/scripts`: Utility scripts (e.g., doc generation).
- `test`: Unit and integration tests.

## API Documentation
The project uses Swagger for API documentation.
To regenerate the `swagger.json` file:
```bash
npm run docs
```
The output will be located at `dist/swagger.json`.

## CI/CD
GitHub Actions are located in `.github/workflows`:
- `ci.yml`: Runs on Push/PR to verify build and tests.
- `deploy.yml`: Handles deployment automation.
