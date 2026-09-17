import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./authz";

export const byMenuItem = query({
  args: { menuItemId: v.id("menuItems") },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner");
    const rows = await ctx.db.query("recipes").withIndex("by_menuItemId", (q) => q.eq("menuItemId", args.menuItemId)).take(100);
    return await Promise.all(rows.map(async (row) => ({ ...row, ingredient: await ctx.db.get(row.ingredientId) })));
  },
});

export const upsert = mutation({
  args: { menuItemId: v.id("menuItems"), ingredientId: v.id("ingredients"), quantity: v.number() },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner");
    if (!Number.isFinite(args.quantity) || args.quantity <= 0) throw new Error("Recipe quantity must be greater than zero");
    if (!await ctx.db.get(args.menuItemId) || !await ctx.db.get(args.ingredientId)) throw new Error("Menu item or ingredient not found");
    const existing = await ctx.db.query("recipes").withIndex("by_menuItemId", (q) => q.eq("menuItemId", args.menuItemId)).filter((q) => q.eq(q.field("ingredientId"), args.ingredientId)).first();
    if (existing) await ctx.db.patch(existing._id, { quantity: args.quantity });
    else await ctx.db.insert("recipes", args);
    return null;
  },
});

export const remove = mutation({
  args: { recipeId: v.id("recipes") },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner");
    const recipe = await ctx.db.get(args.recipeId);
    if (!recipe) throw new Error("Recipe not found");
    await ctx.db.delete(args.recipeId);
    return null;
  },
});
