import { NestFactory } from "@nestjs/core";
import { ValidationPipe, VersioningType } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import {
  json,
  urlencoded,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";

async function bootstrap() {
  /**
   * Body-parsing strategy:
   *
   * 1. Webhook paths (/v1/payments/webhooks/*) get a raw-body middleware that
   *    buffers the exact bytes into req.rawBody. HMAC verification (Paystack,
   *    Flutterwave, Stripe) requires the unmodified buffer — even a single
   *    whitespace change invalidates the signature.
   *
   * 2. Multipart requests (/admin/media/upload) are left completely untouched
   *    so Multer / FileInterceptor can read the stream itself.
   *
   * 3. Everything else gets our json/urlencoded parsers with a 10 MB limit
   *    (overrides NestJS's default 100 kb).
   *
   * Why NOT rawBody:true globally:
   *    NestJS's built-in raw body parser runs before any middleware and
   *    consumes the multipart stream before Multer sees it → 500 on uploads.
   *    Scoping raw-body capture to webhook paths avoids that conflict.
   */
  const app = await NestFactory.create(AppModule);

  // Trust the first upstream proxy (Render load balancer / Vercel edge) so
  // that @Ip() and req.ip return the real client IP from x-forwarded-for
  // instead of the proxy's internal address.
  app.getHttpAdapter().getInstance().set("trust proxy", 1);

  // ── 1. Raw-body capture — webhook paths only ─────────────────────────────
  // Must be registered BEFORE the json/urlencoded parsers so it wins on those
  // paths. Stores the raw Buffer on req.rawBody for HMAC verification.
  const WEBHOOK_PATH_RE = /^\/v1\/payments\/webhooks\//;

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!WEBHOOK_PATH_RE.test(req.path)) return next();

    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      // Attach to the Express request — NestJS RawBodyRequest<Request> reads this
      (req as Request & { rawBody: Buffer }).rawBody = raw;
      next();
    });
    req.on("error", next);
  });

  // ── 2. JSON / URL-encoded parsers — skip multipart so Multer works ────────
  const skipMultipart =
    (handler: ReturnType<typeof json> | ReturnType<typeof urlencoded>) =>
    (req: Request, res: Response, next: NextFunction) => {
      const ct = (req.headers["content-type"] ?? "").toLowerCase();
      if (ct.includes("multipart/form-data")) return next();
      return handler(req, res, next);
    };

  app.use(skipMultipart(json({ limit: "10mb" })));
  app.use(skipMultipart(urlencoded({ limit: "10mb", extended: true })));
  app.use(cookieParser());

  const config = app.get(ConfigService);
  const port = config.get<number>("PORT", 4000);
  const clientOrigin = config.get<string>(
    "CLIENT_ORIGIN",
    "http://localhost:3000",
  );
  const nodeEnv = config.get<string>("NODE_ENV", "development");
  const storefrontUrl = config.get<string>(
    "STOREFRONT_URL",
    "http://localhost:3000",
  );

  // ── CORS ─────────────────────────────────────────────────────────────────────
  app.enableCors({
    origin:
      nodeEnv === "production"
        ? [
            clientOrigin,
            storefrontUrl,
            "https://labiafrica.com",
            "https://www.labiafrica.com",
          ]
        : [clientOrigin, storefrontUrl, /localhost:\d+/],
    credentials: true,
  });

  // ── Validation ───────────────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Response envelope ─────────────────────────────────────────────────────────
  app.useGlobalInterceptors(new TransformInterceptor());

  // ── Exception filter ──────────────────────────────────────────────────────────
  app.useGlobalFilters(new HttpExceptionFilter());

  // ── URI versioning ────────────────────────────────────────────────────────────
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });

  // ── Swagger ───────────────────────────────────────────────────────────────────
  const swaggerEnabled =
    nodeEnv !== "production" ||
    config.get<string>("SWAGGER_ENABLED", "false") === "true";

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("Labi API")
      .setDescription("LÁBí Fashion Platform API")
      .setVersion("1.0")
      .setContact("Labi Dev", storefrontUrl, "dev@labiafrica.com")
      .addServer(`http://localhost:${port}`, "Local development")
      .addServer("https://api.labiafrica.com", "Production")
      .addBearerAuth(
        {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          name: "Authorization",
          in: "header",
        },
        "bearer",
      )
      .addSecurityRequirements("bearer")
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig, {
      operationIdFactory: (_controllerKey, methodKey) => methodKey,
      deepScanRoutes: true,
    });

    SwaggerModule.setup("docs", app, document, {
      customSiteTitle: "Labi API Docs",
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        docExpansion: "none",
        tryItOutEnabled: true,
      },
    });

    console.log(`📖  Swagger docs  → http://localhost:${port}/docs\n`);
  }

  // ── Health check ──────────────────────────────────────────────────────────────
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get(
    "/health",
    (
      _req: unknown,
      res: { status: (code: number) => { json(body: unknown): void } },
    ) => {
      res.status(200).json({
        status: "ok",
        version: "1.0.0",
        timestamp: new Date().toISOString(),
        env: nodeEnv,
      });
    },
  );

  await app.listen(port, "0.0.0.0");
  console.log(`\n🚀  Labi API → http://localhost:${port}`);
  console.log(`❤️   Health check  → http://localhost:${port}/health`);
}

bootstrap();
