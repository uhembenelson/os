import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireRole, requireStaff } from "./authz";

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx);
    const items = await ctx.db.query("menuItems").withIndex("by_active", (q) => q.eq("active", true)).take(100);
    return items.sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || a.name.localeCompare(b.name));
  },
});

export const categories = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx);
    return ctx.db.query("menuCategories").withIndex("by_active_and_sortOrder", (q) => q.eq("active", true)).take(50);
  },
});

export const manageItems = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, "owner");
    const items = await ctx.db.query("menuItems").take(200);
    return items.sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || a.name.localeCompare(b.name));
  },
});

export const manageCategories = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, "owner");
    return ctx.db.query("menuCategories").withIndex("by_active_and_sortOrder").take(100);
  },
});

function categorySlug(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const createCategory = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    await requireRole(ctx, "owner");
    const cleanName = name.trim();
    const slug = categorySlug(cleanName);
    if (!slug) throw new Error("Enter a category name using letters or numbers.");
    if (await ctx.db.query("menuCategories").withIndex("by_slug", (q) => q.eq("slug", slug)).first()) throw new Error("That category already exists.");
    const categories = await ctx.db.query("menuCategories").withIndex("by_active_and_sortOrder").take(100);
    return ctx.db.insert("menuCategories", { name: cleanName, slug, sortOrder: categories.length, active: true });
  },
});

export const renameCategory = mutation({
  args: { categoryId: v.id("menuCategories"), name: v.string() },
  handler: async (ctx, { categoryId, name }) => {
    await requireRole(ctx, "owner");
    const category = await ctx.db.get(categoryId);
    if (!category) throw new Error("Category not found.");
    const cleanName = name.trim();
    const slug = categorySlug(cleanName);
    if (!slug) throw new Error("Enter a category name using letters or numbers.");
    const duplicate = await ctx.db.query("menuCategories").withIndex("by_slug", (q) => q.eq("slug", slug)).first();
    if (duplicate && duplicate._id !== categoryId) throw new Error("That category already exists.");
    const items = await ctx.db.query("menuItems").withIndex("by_category", (q) => q.eq("category", category.name)).take(500);
    for (const item of items) await ctx.db.patch(item._id, { category: cleanName });
    await ctx.db.patch(categoryId, { name: cleanName, slug });
  },
});

export const createItem = mutation({
  args: { name: v.string(), description: v.string(), category: v.string(), priceKobo: v.number() },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner");
    if (!args.name.trim()) throw new Error("Menu item name is required.");
    if (!Number.isFinite(args.priceKobo) || args.priceKobo <= 0) throw new Error("Enter a price greater than zero.");
    const category = await ctx.db.query("menuCategories").withIndex("by_slug").collect();
    if (!category.some((row) => row.name === args.category && row.active)) throw new Error("Choose an active menu category.");
    const items = await ctx.db.query("menuItems").withIndex("by_category", (q) => q.eq("category", args.category)).take(500);
    return ctx.db.insert("menuItems", { name: args.name.trim(), description: args.description.trim(), category: args.category, priceKobo: args.priceKobo, sortOrder: items.length, active: true });
  },
});

export const createItems = mutation({
  args: {
    category: v.string(),
    items: v.array(v.object({ name: v.string(), description: v.string(), priceKobo: v.number() })),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner");
    if (args.items.length === 0) throw new Error("Add at least one menu item.");
    const categories = await ctx.db.query("menuCategories").withIndex("by_slug").collect();
    if (!categories.some((row) => row.name === args.category && row.active)) throw new Error("Choose an active menu category.");
    const existing = await ctx.db.query("menuItems").withIndex("by_category", (q) => q.eq("category", args.category)).take(500);
    let sortOrder = existing.length;
    let count = 0;
    for (const item of args.items) {
      const name = item.name.trim();
      if (!name) throw new Error("Menu item name is required.");
      if (!Number.isFinite(item.priceKobo) || item.priceKobo <= 0) throw new Error(`Enter a price greater than zero for ${name}.`);
      await ctx.db.insert("menuItems", { name, description: item.description.trim(), category: args.category, priceKobo: item.priceKobo, sortOrder, active: true });
      sortOrder += 1;
      count += 1;
    }
    return { count };
  },
});

export const missingRecipes = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, "owner", "manager");
    const items = await ctx.db.query("menuItems").withIndex("by_active", (q) => q.eq("active", true)).take(100);
    const missing: string[] = [];
    for (const item of items) {
      const recipe = await ctx.db.query("recipes").withIndex("by_menuItemId", (q) => q.eq("menuItemId", item._id)).first();
      if (!recipe) missing.push(item.name);
    }
    return missing;
  },
});

export const updateItem = mutation({
  args: {
    menuItemId: v.id("menuItems"),
    name: v.string(),
    description: v.string(),
    category: v.string(),
    priceKobo: v.number(),
    active: v.boolean(),
    soldOut: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner");
    if (!args.name.trim()) throw new Error("Menu item name is required");
    if (!Number.isFinite(args.priceKobo) || args.priceKobo < 0) throw new Error("Price cannot be negative");
    const item = await ctx.db.get(args.menuItemId);
    if (!item) throw new Error("Menu item not found");
    const categories = await ctx.db.query("menuCategories").withIndex("by_slug").collect();
    if (!categories.some((row) => row.name === args.category.trim() && row.active)) throw new Error("Choose an active menu category.");
    await ctx.db.patch(args.menuItemId, { name: args.name.trim(), description: args.description.trim(), category: args.category.trim() || "Mains", priceKobo: args.priceKobo, active: args.active, soldOut: args.soldOut ?? item.soldOut });
    return { menuItemId: item._id };
  },
});

export const setSoldOut = mutation({
  args: { menuItemId: v.id("menuItems"), soldOut: v.boolean() },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager", "cashier");
    const item = await ctx.db.get(args.menuItemId);
    if (!item) throw new Error("Menu item not found");
    await ctx.db.patch(args.menuItemId, { soldOut: args.soldOut });
    return { menuItemId: item._id, soldOut: args.soldOut };
  },
});
