import app from "./app";
import "./shared/queues/email.worker";
import "./shared/queues/interaction.worker";
import logger from "./config/logger";

const PORT = process.env.PORT;

app
  .listen(PORT, () => {
    logger.info(`Server is running on port no ${PORT}`);
  })
  .on("error", (err) => {
    logger.error(`Error while running the server : ${err}`);
    process.exit(1);
  });
