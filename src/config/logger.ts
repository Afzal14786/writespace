import winston from "winston";
import path from "path";
import { env } from "./env";

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  silly: 6,
};

const level = () => {
  const isDevelopment = env.NODE_ENV === "development";
  return isDevelopment ? "debug" : "warn";
};

const colors = {
  error: "red",
  warn: "yellow",
  info: "green",
  http: "magenta",
  verbose: "cyan",
  debug: "white",
  silly: "grey",
};

winston.addColors(colors);

// Custom formats
const devFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(
    (info) => `[${info.level}] ${info.timestamp}: ${info.message}`,
  ),
);

const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json(),
);

const transports = [
  new winston.transports.Console({
    format: env.NODE_ENV === "development" ? devFormat : prodFormat,
  }),
  new winston.transports.File({
    filename: path.join("logs", "error.log"),
    level: "error",
    format: prodFormat,
  }),
  new winston.transports.File({
    filename: path.join("logs", "combined.log"),
    format: prodFormat,
  }),
];

const logger = winston.createLogger({
  level: level(),
  levels,
  transports,
});

export default logger;
