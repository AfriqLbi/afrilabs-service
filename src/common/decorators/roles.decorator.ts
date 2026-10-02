import { SetMetadata } from "@nestjs/common";

export type UserRole =
  "super_admin" | "merchandiser" | "support_agent" | "customer" | "staff"; // production / ops staff — scoped to assigned-order updates

export const ROLES_KEY = "roles";
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
