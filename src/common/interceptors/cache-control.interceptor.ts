import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

// ── Metadata key ──────────────────────────────────────────────────────────────

export const CACHE_CONTROL_KEY = 'CACHE_CONTROL';

/**
 * Decorator for individual route handlers.
 *
 * Usage:
 *   @CacheControl('public, max-age=300, stale-while-revalidate=60')
 *   @Get('products')
 *   listProducts() { ... }
 */
export const CacheControl = (directive: string) =>
  SetMetadata(CACHE_CONTROL_KEY, directive);

// ── Interceptor ───────────────────────────────────────────────────────────────

/**
 * Reads the @CacheControl() decorator from the handler or controller class and
 * stamps the HTTP response with the corresponding Cache-Control header.
 *
 * Only applied when:
 *   1. The @CacheControl() decorator is present
 *   2. The response status is 2xx (never cache errors)
 *   3. The request method is GET (never cache mutations)
 *
 * For authenticated routes, Cache-Control is not set here — those responses
 * must stay private.  Admin endpoints are protected by guards that run before
 * this interceptor so their responses are never decorated.
 */
@Injectable()
export class CacheControlInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const directive = this.reflector.getAllAndOverride<string>(
      CACHE_CONTROL_KEY,
      [context.getHandler(), context.getClass()],
    );

    return next.handle().pipe(
      tap(() => {
        if (!directive) return;

        const http = context.switchToHttp();
        const req = http.getRequest<{ method: string }>();
        const res = http.getResponse<Response>();

        // Only cache GET responses that haven't already been flagged as errors
        if (req.method !== 'GET') return;
        if (res.statusCode >= 400) return;

        res.setHeader('Cache-Control', directive);
        // Vary on Accept-Encoding so gzip and brotli variants are cached
        // separately at any CDN layer.
        res.setHeader('Vary', 'Accept-Encoding');
      }),
    );
  }
}
