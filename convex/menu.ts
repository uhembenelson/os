import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
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

export const seedDefaults = mutation({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, "owner");
    return insertDefaultData(ctx);
  },
});

export const seedStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx);
    const marker = await ctx.db.query("appSettings").withIndex("by_key", (q) => q.eq("key", "defaults")).unique();
    const item = await ctx.db.query("menuItems").withIndex("by_active", (q) => q.eq("active", true)).first();
    return { defaultsSeeded: marker?.defaultsSeeded ?? false, hasMenu: Boolean(item) };
  },
});

export async function markDefaultsSeeded(ctx: MutationCtx) {
  const existing = await ctx.db.query("appSettings").withIndex("by_key", (q) => q.eq("key", "defaults")).unique();
  if (existing) {
    if (!existing.defaultsSeeded) await ctx.db.patch(existing._id, { defaultsSeeded: true });
    return;
  }
  await ctx.db.insert("appSettings", { key: "defaults", defaultsSeeded: true });
}

export async function insertDefaultData(ctx: MutationCtx) {
  await markDefaultsSeeded(ctx);
  const existingItem = await ctx.db.query("menuItems").withIndex("by_active", (q) => q.eq("active", true)).first();
  if (existingItem) return { seeded: false };

  const categoryNames = ["Mains", "Sides", "Drinks", "Snacks"];
  for (const [sortOrder, name] of categoryNames.entries()) {
    await ctx.db.insert("menuCategories", { name, slug: name.toLowerCase(), sortOrder, active: true });
  }

  const ingredientData = [
    { key: "rice", name: "Rice", unit: "kg", quantity: 25, lowStockLevel: 8, costPerUnitKobo: 240000 },
    { key: "chicken", name: "Chicken", unit: "kg", quantity: 12, lowStockLevel: 5, costPerUnitKobo: 420000 },
    { key: "beef", name: "Beef", unit: "kg", quantity: 10, lowStockLevel: 4, costPerUnitKobo: 550000 },
    { key: "goat", name: "Goat meat", unit: "kg", quantity: 7, lowStockLevel: 3, costPerUnitKobo: 650000 },
    { key: "plantain", name: "Plantain", unit: "kg", quantity: 9, lowStockLevel: 4, costPerUnitKobo: 180000 },
    { key: "cabbage", name: "Cabbage", unit: "kg", quantity: 4, lowStockLevel: 2, costPerUnitKobo: 150000 },
    { key: "hibiscus", name: "Hibiscus", unit: "kg", quantity: 3, lowStockLevel: 1, costPerUnitKobo: 200000 },
    { key: "citrus", name: "Citrus mix", unit: "litre", quantity: 8, lowStockLevel: 3, costPerUnitKobo: 110000 },
    { key: "flour", name: "Flour", unit: "kg", quantity: 14, lowStockLevel: 5, costPerUnitKobo: 120000 },
    { key: "oil", name: "Cooking oil", unit: "litre", quantity: 16, lowStockLevel: 6, costPerUnitKobo: 190000 },
  ] as const;
  const ingredientIds = new Map<string, Id<"ingredients">>();
  for (const ingredient of ingredientData) {
    const ingredientId = await ctx.db.insert("ingredients", {
      name: ingredient.name,
      unit: ingredient.unit,
      quantity: ingredient.quantity,
      lowStockLevel: ingredient.lowStockLevel,
      costPerUnitKobo: ingredient.costPerUnitKobo,
      active: true,
    });
    ingredientIds.set(ingredient.key, ingredientId);
  }

  const defaults = [
    { key: "jollof-chicken", name: "Jollof rice & chicken", description: "Smoky jollof, grilled chicken", priceKobo: 450000, category: "Mains", icon: "restaurant-outline", color: "#F4E1D5", recipe: [["rice", 0.3], ["chicken", 0.25], ["oil", 0.04]] as const },
    { key: "suya-platter", name: "Suya platter", description: "Spiced beef, onions, yaji", priceKobo: 600000, category: "Mains", icon: "flame-outline", color: "#F3D9C3", recipe: [["beef", 0.3]] as const },
    { key: "pepper-soup", name: "Goat pepper soup", description: "Slow-cooked, aromatic broth", priceKobo: 520000, category: "Mains", icon: "water-outline", color: "#E4E7D3", recipe: [["goat", 0.3]] as const },
    { key: "fried-plantain", name: "Fried plantain", description: "Golden, sweet plantain", priceKobo: 180000, category: "Sides", icon: "leaf-outline", color: "#F5E7B8", recipe: [["plantain", 0.25], ["oil", 0.03]] as const },
    { key: "coleslaw", name: "Fresh coleslaw", description: "Cabbage, carrot, light dressing", priceKobo: 150000, category: "Sides", icon: "nutrition-outline", color: "#DDEAD6", recipe: [["cabbage", 0.15]] as const },
    { key: "zobo", name: "Zobo cooler", description: "Chilled hibiscus and spice", priceKobo: 120000, category: "Drinks", icon: "wine-outline", color: "#EDD7E1", recipe: [["hibiscus", 0.04]] as const },
    { key: "chapman", name: "Chapman", description: "Citrus, bitters, cucumber", priceKobo: 200000, category: "Drinks", icon: "cafe-outline", color: "#F2DCCB", recipe: [["citrus", 0.25]] as const },
    { key: "chin-chin", name: "Chin chin bowl", description: "Crunchy house-made bites", priceKobo: 150000, category: "Snacks", icon: "fast-food-outline", color: "#EFE3B9", recipe: [["flour", 0.18], ["oil", 0.03]] as const },
  ];

  for (const [sortOrder, item] of defaults.entries()) {
    const { recipe, ...menuItem } = item;
    const menuItemId = await ctx.db.insert("menuItems", { ...menuItem, sortOrder, active: true });
    for (const [ingredientKey, quantity] of recipe) {
      const ingredientId = ingredientIds.get(ingredientKey);
      if (ingredientId) await ctx.db.insert("recipes", { menuItemId, ingredientId, quantity });
    }
  }

  return { seeded: true };
}
