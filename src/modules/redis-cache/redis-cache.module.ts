import { Module, Global } from "@nestjs/common";
import { RedisCacheService } from "./redis-cache.service";

/**
 * Global module — import once in AppModule, use RedisCacheService everywhere.
 */
@Global()
@Module({
  providers: [RedisCacheService],
  exports: [RedisCacheService],
})
export class RedisCacheModule {}
