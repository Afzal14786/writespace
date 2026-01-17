import { createClient, RedisClientType } from "redis";
import env from "./env";

export const client: RedisClientType = createClient({
  url: env.REDIS_URL,
  password: env.REDIS_PASSWORD,
});

client.on("error", (err: Error) => {
  console.error(`Redis Client Error:`, err);
});

/**
 * Connect The Redis
 */

client.on("connect", () => {
  console.log(`Redis connection process initiated`);
});

client.on("ready", () => {
  console.log(`Redis ready and connected successfully`);
});

client.on("reconnecting", () => {
  console.log(`Redis reconnecting...`);
});

/**
 * Connect The Redis client and wait for a successful connection.
 * @returns A promise that resolves when the client is connected and ready.
 */
export const connectRedis = async (): Promise<void> => {
  await client.connect();
};
