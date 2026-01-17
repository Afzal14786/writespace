import express from "express";
import dotenv from "dotenv";
import { connectRedis } from "./config/redis";
import connectDB from "./config/db";
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./config/swagger";
import { postsRoutes } from "./modules/posts/posts.routes";
import { authRoutes } from "./modules/auth/auth.routes";
import { userRoutes } from "./modules/users/user.routes";
import { interactionsRoutes } from "./modules/interactions/interactions.routes";
import morgan from "morgan";
import helmet from "helmet";
import cors from "cors";
import { errorHandler } from "./shared/middlewares/error.middleware";
import { apiLimiter } from "./shared/middlewares/rate-limit.middleware";
import { env } from "./config/env";
import { configurePassport } from "./modules/auth/auth.utils";
import passport from "passport";

dotenv.config();

const app = express();

// =========== Security & Parsing ===========
app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

// =========== Auth Config ===========
configurePassport();
app.use(passport.initialize());

// =========== Security & Rate Limiting ===========
app.use("/api/v1", apiLimiter);

// =========== Documentation ===========
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// =========== Routes ===========
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/posts", postsRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1", interactionsRoutes);

// Global Error Handler
app.use(errorHandler);

// connect Redis
connectRedis();
// connecting the DB
connectDB();
export default app;
