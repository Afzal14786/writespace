import env from "./env";

const redisUrl = new URL(env.REDIS_URL);

const redisProtocol = redisUrl.protocol;

if (redisProtocol !== "redis:" && redisProtocol !== "rediss:") {
  throw new Error("REDIS_URL must use redis:// or rediss://");
}

const databasePath = redisUrl.pathname.replace(/^\//, "");
const redisDatabase = databasePath ? Number(databasePath) : 0;

if (!Number.isSafeInteger(redisDatabase) || redisDatabase < 0) {
  throw new Error("REDIS_URL contains an invalid database number");
}

export const bullmqRedisConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),

  username: redisUrl.username
    ? decodeURIComponent(redisUrl.username)
    : undefined,

  password:
    env.REDIS_PASSWORD ||
    (redisUrl.password
      ? decodeURIComponent(redisUrl.password)
      : undefined),

  db: redisDatabase,

  ...(redisProtocol === "rediss:" ? { tls: {} } : {}),

  connectTimeout: env.REDIS_CONNECT_TIMEOUT_MS,
};
