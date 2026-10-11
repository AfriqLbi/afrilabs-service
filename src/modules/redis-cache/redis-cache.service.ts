import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

/**
 * Thin Redis cache wrapper built on the ioredis client that is already
 * installed for BullMQ.  Uses the same Redis URL/host config so no extra
 * infrastructure is needed.
 *
 * All methods fail silently: if Redis is unavailable the caller falls through
 * to the primary data source (MongoDB / external API) and the cache is simply
 * bypassed rather than throwing.
 *
 * Key naming convention:  labi:<namespace>:<discriminator>
 *   e.g.  labi:geo:US          — geo/context result for country US
 *         labi:fx:rates        — full FX rate array
 *         labi:catalog:products:<hash> — paginated product list
 */
@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly client: Redis | null;

  constructor(private readonly config: ConfigService) {
    const url = config.get<string>("redis.url");
    const host = config.get<string>("redis.host", "localhost");
    const port = config.get<number>("redis.port", 6379);
    const password = config.get<string | undefined>("redis.password");

    try {
      this.client = url
        ? new Redis(url, {
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            lazyConnect: true,
            enableOfflineQueue: false, // don't queue — fail fast if disconnected
          })
        : new Redis({
            host,
            port,
            password: password || undefined,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            lazyConnect: true,
            enableOfflineQueue: false,
          });

      this.client.on("error", (err: Error) => {
        // Log at debug level — Redis being down should not spam production logs
        this.logger.debug(`Redis cache error (non-fatal): ${err.message}`);
      });
    } catch {
      this.logger.warn("Could not initialise Redis cache client — caching disabled");
      this.client = null;
    }
  }

  // ── Core operations ──────────────────────────────────────────────────────

  /**
   * Returns a cached JSON value, or null on miss / error.
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.client) return null;
    try {
      const raw = await this.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  /**
   * Stores a JSON value with a TTL in seconds.
   * Fails silently if Redis is unavailable.
   */
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch {
      // non-fatal
    }
  }

  /**
   * Deletes one or more keys by exact name or glob pattern.
   * Used to bust the cache after admin writes (e.g. new FX rates, product update).
   */
  async del(...keys: string[]): Promise<void> {
    if (!this.client || keys.length === 0) return;
    try {
      await this.client.del(...keys);
    } catch {
      // non-fatal
    }
  }

  /**
   * Deletes all keys matching a glob pattern.
   * Uses SCAN to avoid blocking the Redis server.
   */
  async delByPattern(pattern: string): Promise<void> {
    if (!this.client) return;
    try {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await this.client.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          100,
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.client.del(...keys);
        }
      } while (cursor !== "0");
    } catch {
      // non-fatal
    }
  }

  // ── Cache-aside helper ────────────────────────────────────────────────────

  /**
   * Cache-aside pattern:
   *   1. Try to return cached value.
   *   2. On miss, call `fn()` to get the fresh value.
   *   3. Store the fresh value in Redis with `ttlSeconds`.
   *   4. Return the fresh value.
   *
   * @example
   * const rates = await cache.wrap("labi:fx:rates", 3600, () => this.fetchRates());
   */
  async wrap<T>(
    key: string,
    ttlSeconds: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const fresh = await fn();
    // Fire-and-forget — don't block the response on a Redis write
    this.set(key, fresh, ttlSeconds).catch(() => {});
    return fresh;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit().catch(() => {});
    }
  }
}
