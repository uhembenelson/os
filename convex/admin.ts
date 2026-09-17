import { internalMutation, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { TableNames } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireRole } from "./authz";
import { insertDefaultData, markDefaultsSeeded } from "./menu";

const CONFIRMATION = "RESET";
const BATCH_PER_TABLE = 400;
const MAX_TOTAL = 2000;
const STAFF_BATCH = 200;

const BUSINESS_TABLES = [
  "refunds",
  "payments",
  "inventoryMovements",
  "recipes",
  "purchaseItems",
  "purchases",
  "expenses",
  "orders",
  "shifts",
  "ingredients",
  "menuItems",
  "menuCategories",
  "pinAttempts",
] as const;

async function clearBatch(ctx: MutationCtx, budget: number) {
  let deleted = 0;
  for (const table of BUSINESS_TABLES) {
    const take = Math.min(BATCH_PER_TABLE, budget - deleted);
    if (take <= 0) break;
    const rows = await ctx.db.query(table).take(take);
    for (const row of rows) await ctx.db.delete(row._id);
    deleted += rows.length;
  }
  return deleted;
}

async function removeNonOwnerStaff(ctx: MutationCtx, budget: number) {
  const users = await ctx.db.query("users").take(budget);
  let removed = 0;
  for (const user of users) {
    if (user.role === "owner") continue;
    const pins = await ctx.db.query("staffPins").withIndex("by_userId", (q) => q.eq("userId", user._id)).take(10);
    for (const pin of pins) await ctx.db.delete(pin._id);
    await ctx.db.delete(user._id);
    removed += 1;
  }
  return removed;
}

async function hasRemaining(ctx: MutationCtx) {
  for (const table of BUSINESS_TABLES) {
    const row = await ctx.db.query(table).take(1);
    if (row.length) return true;
  }
  const users = await ctx.db.query("users").take(STAFF_BATCH);
  return users.some((user) => user.role !== "owner");
}

export const resetAllData = mutation({
  args: {
    confirm: v.string(),
    reseed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner");
    if (args.confirm.trim().toUpperCase() !== CONFIRMATION) throw new Error("Type RESET to confirm.");
    const reseed = args.reseed ?? true;
    await markDefaultsSeeded(ctx);

    const deleted = await clearBatch(ctx, MAX_TOTAL);
    const removedStaff = await removeNonOwnerStaff(ctx, STAFF_BATCH);
    if (await hasRemaining(ctx)) {
      await ctx.scheduler.runAfter(0, internal.admin.finishReset, { reseed });
      return { finished: false, deleted, removedStaff, seeded: false };
    }
    const seeded = reseed ? (await insertDefaultData(ctx)).seeded : false;
    return { finished: true, deleted, removedStaff, seeded };
  },
});

export const finishReset = internalMutation({
  args: { reseed: v.boolean() },
  handler: async (ctx, args) => {
    await clearBatch(ctx, MAX_TOTAL);
    await removeNonOwnerStaff(ctx, STAFF_BATCH);
    if (await hasRemaining(ctx)) {
      await ctx.scheduler.runAfter(0, internal.admin.finishReset, { reseed: args.reseed });
      return;
    }
    if (args.reseed) await insertDefaultData(ctx);
    else await markDefaultsSeeded(ctx);
  },
});
