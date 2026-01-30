import morgan from "morgan";
import logger from "../../config/logger";

const stream = {
  write: (message: string) => {
    logger.http(message.trim());
  },
};

const httpLogger = morgan(
  ":method :url :status :res[content-length] - :response-time ms",
  { stream },
);

export default httpLogger;
