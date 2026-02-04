import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import { connectRedis } from "./config/redis";
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./config/swagger";
import { postsRoutes } from "./modules/posts/posts.routes";
import { authRoutes } from "./modules/auth/auth.routes";
import { userRoutes } from "./modules/users/user.routes";
import { interactionsRoutes } from "./modules/interactions/interactions.routes";
import httpLogger from "./shared/middlewares/httpLogger";
import helmet from "helmet";
import cors from "cors";
import { errorHandler } from "./shared/middlewares/error.middleware";
import { apiLimiter } from "./shared/middlewares/rate-limit.middleware";
import { env } from "./config/env";
import { configurePassport } from "./modules/auth/auth.utils";
import passport from "passport";
import { pool } from "./db";
import logger from "./config/logger";

dotenv.config();

const app = express();

app.set("trust proxy", 1);

app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(httpLogger);

configurePassport();
app.use(passport.initialize());

app.use("/api/v1", apiLimiter);

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/posts", postsRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1", interactionsRoutes);

app.use(errorHandler);

connectRedis();

pool
  .query("SELECT 1")
  .then(() => logger.info("PostgreSQL connected successfully"))
  .catch((err) => {
    logger.error(`PostgreSQL connection failed: ${err}`);
    process.exit(1);
  });

export default app;
