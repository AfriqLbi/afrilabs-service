/**
 * Auth controller — httpOnly cookies on .labiafrica.com
 *
 * labiafrica.com (frontend) and api.labiafrica.com (backend) share the same
 * root domain, so cookies with domain=".labiafrica.com" are sent automatically
 * by the browser on every request — no localStorage, no Authorization header.
 *
 * Cookie names:
 *   labi_at          — access token  (15 min, httpOnly)
 *   labi_rt          — refresh token (7 days, httpOnly)
 *   labi_admin_at    — admin access token  (15 min, httpOnly)
 *   labi_admin_rt    — admin refresh token (7 days, httpOnly)
 */
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
} from "@nestjs/swagger";
import { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtPayload } from "./strategies/jwt.strategy";
import {
  ApiEnvelopeCreated,
  ApiEnvelopeOk,
  ApiErrorResponse,
} from "../../common/swagger/api-response.decorator";
import {
  AuthResponseDto,
  AuthUserDto,
} from "../../common/swagger/swagger-response.dto";

// ── Cookie helpers ─────────────────────────────────────────────────────────────

const IS_PROD = process.env.NODE_ENV === "production";
const COOKIE_DOMAIN = IS_PROD ? ".labiafrica.com" : undefined;

const BASE_OPTS = {
  httpOnly: true,
  secure: IS_PROD,
  // same-site strict works when frontend and API share the same root domain.
  // Use "lax" so the cookie is also sent on top-level navigations (e.g. payment redirects).
  sameSite: (IS_PROD ? "lax" : "lax") as "lax",
  ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
  path: "/",
} as const;

function setAccessCookie(res: Response, token: string, name: string) {
  res.cookie(name, token, {
    ...BASE_OPTS,
    maxAge: 15 * 60 * 1000, // 15 min — matches JWT expiry
  });
}

function setRefreshCookie(res: Response, token: string, name: string) {
  res.cookie(name, token, {
    ...BASE_OPTS,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

function clearCookies(res: Response, ...names: string[]) {
  const clearOpts = { ...BASE_OPTS, maxAge: 0 };
  names.forEach((n) => res.cookie(n, "", clearOpts));
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getRefreshFromCookie(req: Request, name: string): string | undefined {
  return (req.cookies as Record<string, string>)?.[name];
}

const ADMIN_ROLES = ["super_admin", "merchandiser", "support_agent", "staff"];

// ── Storefront auth ────────────────────────────────────────────────────────────

@ApiTags("Auth — Storefront")
@Controller({ path: "auth", version: "1" })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  @ApiOperation({ summary: "Register a new customer account" })
  @ApiEnvelopeCreated(AuthResponseDto)
  @ApiConflictResponse({
    description: "Email already registered",
    type: ApiErrorResponse,
  })
  @ApiBadRequestResponse({
    description: "Validation error",
    type: ApiErrorResponse,
  })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.authService.register(dto);
    setAccessCookie(res, data.accessToken, "labi_at");
    setRefreshCookie(res, data.refreshToken, "labi_rt");
    return { user: data.user };
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Customer login — sets httpOnly cookies on .labiafrica.com",
  })
  @ApiEnvelopeOk(AuthResponseDto)
  @ApiUnauthorizedResponse({
    description: "Invalid credentials",
    type: ApiErrorResponse,
  })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.authService.login(dto);
    if (ADMIN_ROLES.includes(data.user.role)) {
      throw new ForbiddenException(
        "Admin accounts must use /v1/admin/auth/login",
      );
    }
    setAccessCookie(res, data.accessToken, "labi_at");
    setRefreshCookie(res, data.refreshToken, "labi_rt");
    return { user: data.user };
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Refresh customer tokens via cookie" })
  @ApiEnvelopeOk(AuthResponseDto)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = getRefreshFromCookie(req, "labi_rt");
    if (!refreshToken) {
      clearCookies(res, "labi_at", "labi_rt");
      throw new ForbiddenException("No refresh token");
    }
    const payload = this.authService["jwtService"].decode(
      refreshToken,
    ) as JwtPayload | null;
    if (!payload?.sub) {
      clearCookies(res, "labi_at", "labi_rt");
      throw new ForbiddenException("Invalid refresh token");
    }
    const data = await this.authService.refreshTokens(
      payload.sub,
      refreshToken,
    );
    setAccessCookie(res, data.accessToken, "labi_at");
    setRefreshCookie(res, data.refreshToken, "labi_rt");
    return { user: data.user };
  }

  @UseGuards(JwtAuthGuard)
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Customer logout — clears cookies and invalidates refresh token",
  })
  @ApiResponse({ status: 200 })
  async logout(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(user.sub);
    clearCookies(res, "labi_at", "labi_rt");
    return { message: "Logged out" };
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  @ApiOperation({ summary: "Get current customer profile" })
  @ApiEnvelopeOk(AuthUserDto)
  @ApiUnauthorizedResponse({
    description: "Missing or invalid JWT",
    type: ApiErrorResponse,
  })
  me(@CurrentUser() user: JwtPayload) {
    return this.authService.profile(user.sub);
  }
}

// ── Admin auth ─────────────────────────────────────────────────────────────────

@ApiTags("Auth — Admin")
@Controller({ path: "admin/auth", version: "1" })
export class AdminAuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Admin login — sets separate httpOnly admin cookies",
    description:
      "Only super_admin, merchandiser, support_agent, and staff are accepted. " +
      "Customer accounts are rejected with 403.",
  })
  @ApiEnvelopeOk(AuthResponseDto)
  @ApiUnauthorizedResponse({
    description: "Invalid credentials",
    type: ApiErrorResponse,
  })
  @ApiForbiddenResponse({
    description: "Not an admin account",
    type: ApiErrorResponse,
  })
  async adminLogin(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.authService.login(dto);
    if (!ADMIN_ROLES.includes(data.user.role)) {
      throw new ForbiddenException("This account does not have admin access");
    }
    setAccessCookie(res, data.accessToken, "labi_admin_at");
    setRefreshCookie(res, data.refreshToken, "labi_admin_rt");
    return { user: data.user };
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Refresh admin tokens via cookie" })
  async adminRefresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = getRefreshFromCookie(req, "labi_admin_rt");
    if (!refreshToken) {
      clearCookies(res, "labi_admin_at", "labi_admin_rt");
      throw new ForbiddenException("No admin refresh token");
    }
    const payload = this.authService["jwtService"].decode(
      refreshToken,
    ) as JwtPayload | null;
    if (!payload?.sub) {
      clearCookies(res, "labi_admin_at", "labi_admin_rt");
      throw new ForbiddenException("Invalid refresh token");
    }
    const data = await this.authService.refreshTokens(
      payload.sub,
      refreshToken,
    );
    setAccessCookie(res, data.accessToken, "labi_admin_at");
    setRefreshCookie(res, data.refreshToken, "labi_admin_rt");
    return { user: data.user };
  }

  @UseGuards(JwtAuthGuard)
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Admin logout — clears admin cookies" })
  async adminLogout(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(user.sub);
    clearCookies(res, "labi_admin_at", "labi_admin_rt");
    return { message: "Admin logged out" };
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  @ApiOperation({ summary: "Get current admin profile" })
  @ApiEnvelopeOk(AuthUserDto)
  me(@CurrentUser() user: JwtPayload) {
    return this.authService.profile(user.sub);
  }
}

// ── Admin users management ─────────────────────────────────────────────────────

@ApiTags("Admin — Users")
@ApiBearerAuth()
@Controller({ path: "admin/users", version: "1" })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin")
@ApiForbiddenResponse({
  description: "Super admin only",
  type: ApiErrorResponse,
})
export class AdminUsersController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  @ApiOperation({ summary: "[Admin] List all admin users" })
  listAdminUsers() {
    return this.authService.listAdminUsers();
  }
}
