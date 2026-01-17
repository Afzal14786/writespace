import mongoose from "mongoose";
import env from "./env";

const connectDB = () => {
  mongoose
    .connect(env.MONGO_URI, {
      dbName: "writespace",
    })
    .then(() => {
      console.log(`Database connected successfully`);
    })
    .catch((err) => {
      console.log(`Something err while connecting database : ${err}`);
    });
};

export default connectDB;
