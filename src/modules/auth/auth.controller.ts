import {
  Body,
  Controller,
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
import { Response } from "express";
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

/** Write the customer httpOnly cookie */
function setCustomerCookie(res: Response, token: string) {
  res.cookie("labi_token", token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? "none" : "lax",
    maxAge: 15 * 60 * 1000, // 15 min — matches access token expiry
    path: "/",
  });
}

/** Write the admin httpOnly cookie */
function setAdminCookie(res: Response, token: string) {
  res.cookie("labi_admin_token", token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? "none" : "lax",
    maxAge: 15 * 60 * 1000,
    path: "/",
  });
}

/** Write the refresh httpOnly cookie (shared for both flows) */
function setRefreshCookie(res: Response, token: string, name: string) {
  res.cookie(name, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: "/",
  });
}

function clearAuthCookies(res: Response) {
  const opts = {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? "none" : "lax",
  } as const;
  res.clearCookie("labi_token", { ...opts, path: "/" });
  res.clearCookie("labi_token_refresh", { ...opts, path: "/" });
}

function clearAdminCookies(res: Response) {
  const opts = {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? "none" : "lax",
  } as const;
  res.clearCookie("labi_admin_token", { ...opts, path: "/" });
  res.clearCookie("labi_admin_token_refresh", { ...opts, path: "/" });
}

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
    setCustomerCookie(res, data.accessToken);
    setRefreshCookie(res, data.refreshToken, "labi_token_refresh");
    return { user: data.user };
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Customer login — sets httpOnly cookie" })
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
    // Block admin roles from the customer login endpoint
    const adminRoles = [
      "super_admin",
      "merchandiser",
      "support_agent",
      "staff",
    ];
    if (adminRoles.includes(data.user.role)) {
      throw new Error("Admin accounts must use /v1/admin/auth/login");
    }
    setCustomerCookie(res, data.accessToken);
    setRefreshCookie(res, data.refreshToken, "labi_token_refresh");
    return { user: data.user };
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Refresh customer token via cookie" })
  @ApiEnvelopeOk(AuthResponseDto)
  async refresh(
    @Req() req: { cookies: Record<string, string> },
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.labi_token_refresh;
    if (!refreshToken) {
      clearAuthCookies(res);
      throw new Error("No refresh token");
    }
    const payload = this.authService["jwtService"].decode(
      refreshToken,
    ) as JwtPayload | null;
    if (!payload?.sub) {
      clearAuthCookies(res);
      throw new Error("Invalid refresh token");
    }
    const data = await this.authService.refreshTokens(
      payload.sub,
      refreshToken,
    );
    setCustomerCookie(res, data.accessToken);
    setRefreshCookie(res, data.refreshToken, "labi_token_refresh");
    return { user: data.user };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Logout — clear customer cookies" })
  @ApiResponse({ status: 200 })
  async logout(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(user.sub);
    clearAuthCookies(res);
    return { message: "Logged out" };
  }

  @ApiBearerAuth()
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
    summary: "Admin login — sets separate httpOnly admin cookie",
    description:
      "Only accounts with role `super_admin`, `merchandiser`, `support_agent`, or `staff` " +
      "are accepted. Regular customers are rejected with 403.",
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
    const adminRoles = [
      "super_admin",
      "merchandiser",
      "support_agent",
      "staff",
    ];
    if (!adminRoles.includes(data.user.role)) {
      clearAdminCookies(res);
      const { ForbiddenException } = await import("@nestjs/common");
      throw new ForbiddenException("This account does not have admin access");
    }
    setAdminCookie(res, data.accessToken);
    setRefreshCookie(res, data.refreshToken, "labi_admin_token_refresh");
    return { user: data.user };
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Refresh admin token via cookie" })
  async adminRefresh(
    @Req() req: { cookies: Record<string, string> },
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.labi_admin_token_refresh;
    if (!refreshToken) {
      clearAdminCookies(res);
      throw new Error("No admin refresh token");
    }
    const payload = this.authService["jwtService"].decode(
      refreshToken,
    ) as JwtPayload | null;
    if (!payload?.sub) {
      clearAdminCookies(res);
      throw new Error("Invalid refresh token");
    }
    const data = await this.authService.refreshTokens(
      payload.sub,
      refreshToken,
    );
    setAdminCookie(res, data.accessToken);
    setRefreshCookie(res, data.refreshToken, "labi_admin_token_refresh");
    return { user: data.user };
  }

  @UseGuards(JwtAuthGuard)
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Admin logout — clear admin cookies" })
  async adminLogout(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(user.sub);
    clearAdminCookies(res);
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
