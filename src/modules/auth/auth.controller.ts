/**
 * Auth controller — returns JWT tokens in the JSON response body.
 *
 * Tokens are stored in the frontend's localStorage and sent as
 * Authorization: Bearer headers on every request. This works reliably
 * across different domains (Vercel frontend → Render backend) without
 * any cross-origin cookie restrictions.
 */
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
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
import { AuthService } from "./auth.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
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
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Customer login — returns token pair in body" })
  @ApiEnvelopeOk(AuthResponseDto)
  @ApiUnauthorizedResponse({
    description: "Invalid credentials",
    type: ApiErrorResponse,
  })
  async login(@Body() dto: LoginDto) {
    const data = await this.authService.login(dto);
    if (ADMIN_ROLES.includes(data.user.role)) {
      throw new ForbiddenException(
        "Admin accounts must use /v1/admin/auth/login",
      );
    }
    return data;
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Refresh customer token pair" })
  @ApiEnvelopeOk(AuthResponseDto)
  @ApiUnauthorizedResponse({
    description: "Invalid or expired refresh token",
    type: ApiErrorResponse,
  })
  refresh(@Body() dto: RefreshTokenDto) {
    const payload = this.authService["jwtService"].decode(
      dto.refreshToken,
    ) as JwtPayload | null;
    if (!payload?.sub) throw new Error("Invalid refresh token structure");
    return this.authService.refreshTokens(payload.sub, dto.refreshToken);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Logout — invalidate refresh token server-side" })
  @ApiResponse({ status: 200 })
  logout(@CurrentUser() user: JwtPayload) {
    return this.authService.logout(user.sub);
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
    summary: "Admin login — returns token pair in body",
    description:
      "Only super_admin, merchandiser, support_agent, and staff roles are accepted. " +
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
  async adminLogin(@Body() dto: LoginDto) {
    const data = await this.authService.login(dto);
    if (!ADMIN_ROLES.includes(data.user.role)) {
      throw new ForbiddenException("This account does not have admin access");
    }
    return data;
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Refresh admin token pair" })
  @ApiEnvelopeOk(AuthResponseDto)
  adminRefresh(@Body() dto: RefreshTokenDto) {
    const payload = this.authService["jwtService"].decode(
      dto.refreshToken,
    ) as JwtPayload | null;
    if (!payload?.sub) throw new Error("Invalid refresh token structure");
    return this.authService.refreshTokens(payload.sub, dto.refreshToken);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Admin logout — invalidate refresh token server-side",
  })
  adminLogout(@CurrentUser() user: JwtPayload) {
    return this.authService.logout(user.sub);
  }

  @ApiBearerAuth()
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
