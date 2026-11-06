# Base image

FROM node:24-bookworm-slim AS base

WORKDIR /app


# Development

FROM base AS development

ENV NODE_ENV=development

# Install all dependencies, including devDependencies.
COPY package*.json ./
RUN npm ci

# Copy project files into the container.
COPY . .

# Create directories used by the application.
RUN mkdir -p logs uploads

EXPOSE 8000

CMD ["npm", "run", "dev"]


# Build

FROM base AS builder

COPY package*.json ./
RUN npm ci

COPY . .

# Compile TypeScript and resolve path aliases.
RUN npm run build


# Production

FROM base AS production

ENV NODE_ENV=production

# Install production dependencies only.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy only the compiled application.
COPY --from=builder /app/dist ./dist

# Prepare writable runtime directories.
RUN mkdir -p logs uploads \
    && chown -R node:node logs uploads

# Run the API as a non-root user.
USER node

EXPOSE 8000

CMD ["node", "dist/server.js"]
