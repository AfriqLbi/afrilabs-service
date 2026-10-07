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
import * as cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";

async function bootstrap() {
  /**
   * rawBody: true  — NestJS v10 captures req.rawBody for webhook HMAC verification.
   *                  Requires the built-in body parser to be enabled (no bodyParser:false).
   *
   * After NestFactory.create we register our own json/urlencoded parsers with
   * a 10 MB limit to override the 100 kb default. These parsers explicitly skip
   * multipart/form-data requests so Multer (FileInterceptor) can read the stream
   * unmodified. This was the root cause of the 500 on /admin/media/upload.
   */
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });

  // Raise body size limit to 10 MB; skip multipart so Multer works correctly.
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
