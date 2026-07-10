/** Direct Redis access for rights-cache assertions. Throws if REDIS_HOST is unset. */
import Redis from "ioredis";
import { redisHost, redisPort } from "../config/env";

export function createRedisClient(): Redis {
  return new Redis({ host: redisHost(), port: redisPort() });
}
