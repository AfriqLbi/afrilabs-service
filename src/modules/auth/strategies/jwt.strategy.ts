import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectModel } from "@nestjs/mongoose";
import { PassportStrategy } from "@nestjs/passport";
import { Model } from "mongoose";
import { Strategy } from "passport-jwt";
import { User, UserDocument } from "../schemas/user.schema";
import { Request } from "express";

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  aud?: "customer" | "admin"; // audience claim — distinguishes token type
  iat?: number;
  exp?: number;
}

/**
 * Extract JWT from:
 *   1. httpOnly cookie  `labi_token`  (storefront customers)
 *   2. httpOnly cookie  `labi_admin_token` (admin panel)
 *   3. Authorization: Bearer header  (API/Swagger/fallback)
 */
function cookieOrBearer(req: Request): string | null {
  if (req.cookies?.labi_token) return req.cookies.labi_token as string;
  if (req.cookies?.labi_admin_token)
    return req.cookies.labi_admin_token as string;
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
    return {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      aud: payload.aud,
    };
  }
}
