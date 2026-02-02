import { Logger, ConsoleTransport, FileTransport } from "zario";
import path from "path";
import { env } from "./env";

const isDevelopment = env.NODE_ENV === "development";

const logger = new Logger({
  level: isDevelopment ? "debug" : "warn",
  colorize: isDevelopment,
  json: !isDevelopment,
  prefix: "[WriteSpace]",
  transports: [
    new ConsoleTransport(),
    new FileTransport({
      path: path.join("logs", "error.log"),
      maxSize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
    new FileTransport({
      path: path.join("logs", "combined.log"),
      maxSize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

export default logger;
