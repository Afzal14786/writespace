import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import cors from "cors";
import passport from "passport";

import { env } from "./config/env";
import { configurePassport } from "./modules/auth/auth.utils";
import routes from "./routes/index";

import httpLogger from "./shared/middlewares/http-logger.middleware";
import { apiLimiter } from "./shared/middlewares/rate-limit.middleware";
import { botInterceptor } from "./shared/middlewares/bot-interceptor.middleware";
import { errorHandler } from "./shared/middlewares/error.middleware";

const app = express();

app.set("trust proxy", env.TRUST_PROXY_HOPS);

// Security and request parsing
app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HTTP request logging
app.use(httpLogger);

// Static file serving
app.use("/uploads", express.static("uploads"));

// Authentication
configurePassport();
app.use(passport.initialize());

// Request interception
app.use(botInterceptor);

// API routes
app.use("/api/v1", apiLimiter, routes);

// Health check
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Error handler must be registered last
app.use(errorHandler);

export default app;
