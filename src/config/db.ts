import mongoose from "mongoose";
import env from "./env";
import logger from "./logger";

const connectDB = () => {
  mongoose
    .connect(env.MONGO_URI, {
      dbName: "writespace",
    })
    .then(() => {
      logger.info(`Database connected successfully`);
    })
    .catch((err) => {
      logger.error(`Something err while connecting database : ${err}`);
    });
};

export default connectDB;
