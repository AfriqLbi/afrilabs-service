import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectModel } from "@nestjs/mongoose";
import { PassportStrategy } from "@nestjs/passport";
import { Model } from "mongoose";
import { Strategy } from "passport-jwt";
import { ExtractJwt } from "passport-jwt";
import { User, UserDocument } from "../schemas/user.schema";
import { Request } from "express";

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

/**
 * Extract JWT from:
 *   1. labi_at cookie       (customer — set by /auth/login)
 *   2. labi_admin_at cookie (admin    — set by /admin/auth/login)
 *   3. Authorization: Bearer header  (Swagger UI / dev fallback)
 */
function cookieOrBearer(req: Request): string | null {
  const cookies = req.cookies as Record<string, string> | undefined;
  if (cookies?.labi_at) return cookies.labi_at;
  if (cookies?.labi_admin_at) return cookies.labi_admin_at;
  const auth = req.headers?.authorization ?? "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(
    config: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {
    super({
      jwtFromRequest: cookieOrBearer,
      ignoreExpiration: false,
      secretOrKey: config.get<string>("jwt.secret")!,
      passReqToCallback: false,
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const user = await this.userModel
      .findOne({ _id: payload.sub, active: true })
      .lean();
    if (!user) throw new UnauthorizedException("User not found or inactive");
    return { sub: payload.sub, email: payload.email, role: payload.role };
  }
}
