import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export type StaffRole = "owner" | "manager" | "cashier" | "kitchen";
type StaffContext = QueryCtx | MutationCtx;

export async function requireStaff(ctx: StaffContext) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Sign in is required.");
  const staff = await ctx.db.get(userId);
  if (!staff || staff.active === false || !staff.role) throw new Error("This staff account is inactive or unavailable.");
  return staff as typeof staff & { role: StaffRole };
}

export async function requireRole(ctx: StaffContext, ...roles: StaffRole[]) {
  const staff = await requireStaff(ctx);
  if (!roles.includes(staff.role)) throw new Error("You do not have permission to perform this action.");
  return staff;
}
