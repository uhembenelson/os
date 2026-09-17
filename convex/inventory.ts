import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireRole } from "./authz";

export const listIngredients = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, "owner", "manager");
    return ctx.db.query("ingredients").withIndex("by_name").take(200);
  },
});

export const recentMovements = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, "owner", "manager");
    const movements = await ctx.db.query("inventoryMovements").withIndex("by_createdAt").order("desc").take(30);
    return await Promise.all(movements.map(async (movement) => ({ ...movement, ingredient: await ctx.db.get(movement.ingredientId) })));
  },
});

export const stockReport = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager");
    const ingredients = await ctx.db.query("ingredients").withIndex("by_name").take(200);
    const stockValueKobo = ingredients.reduce((sum, ingredient) => sum + Math.max(0, ingredient.quantity) * (ingredient.costPerUnitKobo ?? 0), 0);
    const lowStockCount = ingredients.filter((ingredient) => ingredient.quantity <= ingredient.lowStockLevel).length;
    const negativeStockCount = ingredients.filter((ingredient) => ingredient.quantity < 0).length;
    const movements = await ctx.db.query("inventoryMovements").withIndex("by_createdAt", (q) => q.gte("createdAt", args.from).lt("createdAt", args.to)).take(3000);
    const byId = new Map(ingredients.map((ingredient) => [ingredient._id, ingredient]));
    let wasteValueKobo = 0;
    const usage = new Map<string, { name: string; unit: string; quantity: number }>();
    for (const movement of movements) {
      const ingredient = byId.get(movement.ingredientId);
      if (!ingredient) continue;
      if (movement.type === "waste") wasteValueKobo += Math.abs(movement.quantityDelta) * (ingredient.costPerUnitKobo ?? 0);
      if (movement.type === "sale" || movement.type === "waste") {
        const row = usage.get(movement.ingredientId) ?? { name: ingredient.name, unit: ingredient.unit, quantity: 0 };
        row.quantity += Math.abs(movement.quantityDelta);
        usage.set(movement.ingredientId, row);
      }
    }
    const mostUsed = Array.from(usage.values()).sort((a, b) => b.quantity - a.quantity).slice(0, 5);
    return { stockValueKobo, lowStockCount, negativeStockCount, wasteValueKobo, mostUsed };
  },
});

export const receiveStock = mutation({
  args: {
    ingredientId: v.id("ingredients"),
    quantity: v.number(),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager");
    if (!Number.isFinite(args.quantity) || args.quantity <= 0) throw new Error("Quantity must be greater than zero");
    const ingredient = await ctx.db.get(args.ingredientId);
    if (!ingredient) throw new Error("Ingredient not found");
    const quantity = ingredient.quantity + args.quantity;
    await ctx.db.patch(args.ingredientId, { quantity });
    await ctx.db.insert("inventoryMovements", {
      ingredientId: ingredient._id,
      type: "receive",
      quantityDelta: args.quantity,
      balanceAfter: quantity,
      note: "Stock received",
      createdAt: Date.now(),
    });
    return { ingredientId: ingredient._id, quantity };
  },
});

export const recordWaste = mutation({
  args: {
    ingredientId: v.id("ingredients"),
    quantity: v.number(),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager");
    if (!Number.isFinite(args.quantity) || args.quantity <= 0) throw new Error("Quantity must be greater than zero");
    const ingredient = await ctx.db.get(args.ingredientId);
    if (!ingredient) throw new Error("Ingredient not found");
    const quantity = ingredient.quantity - args.quantity;
    await ctx.db.patch(args.ingredientId, { quantity });
    await ctx.db.insert("inventoryMovements", {
      ingredientId: ingredient._id,
      type: "waste",
      quantityDelta: -args.quantity,
      balanceAfter: quantity,
      note: "Waste recorded",
      createdAt: Date.now(),
    });
    return { ingredientId: ingredient._id, quantity };
  },
});

export const adjustStock = mutation({
  args: {
    ingredientId: v.id("ingredients"),
    quantity: v.number(),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager");
    if (!Number.isFinite(args.quantity)) throw new Error("Enter a valid stock quantity");
    const ingredient = await ctx.db.get(args.ingredientId);
    if (!ingredient) throw new Error("Ingredient not found");
    const quantityDelta = args.quantity - ingredient.quantity;
    await ctx.db.patch(args.ingredientId, { quantity: args.quantity });
    await ctx.db.insert("inventoryMovements", {
      ingredientId: ingredient._id,
      type: "adjustment",
      quantityDelta,
      balanceAfter: args.quantity,
      note: "Stock count adjusted",
      createdAt: Date.now(),
    });
    return { ingredientId: ingredient._id, quantity: args.quantity };
  },
});

export const setLowStockLevel = mutation({
  args: {
    ingredientId: v.id("ingredients"),
    lowStockLevel: v.number(),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager");
    if (!Number.isFinite(args.lowStockLevel) || args.lowStockLevel < 0) throw new Error("Low-stock level cannot be negative");
    const ingredient = await ctx.db.get(args.ingredientId);
    if (!ingredient) throw new Error("Ingredient not found");
    await ctx.db.patch(args.ingredientId, { lowStockLevel: args.lowStockLevel });
    return { ingredientId: ingredient._id, lowStockLevel: args.lowStockLevel };
  },
});

async function assertIngredientNameFree(ctx: import("./_generated/server").MutationCtx, name: string, exceptId?: Id<"ingredients">) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Enter an ingredient name");
  const existing = await ctx.db.query("ingredients").withIndex("by_name").take(200);
  const clash = existing.find((ingredient) => ingredient._id !== exceptId && ingredient.name.trim().toLowerCase() === trimmed.toLowerCase());
  if (clash) throw new Error(`${trimmed} already exists`);
  return trimmed;
}

export const createIngredient = mutation({
  args: {
    name: v.string(),
    unit: v.string(),
    quantity: v.optional(v.number()),
    lowStockLevel: v.optional(v.number()),
    costPerUnitKobo: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager");
    const name = await assertIngredientNameFree(ctx, args.name);
    const unit = args.unit.trim();
    if (!unit) throw new Error("Enter a unit (for example kg or litre)");
    const quantity = args.quantity ?? 0;
    const lowStockLevel = args.lowStockLevel ?? 0;
    const costPerUnitKobo = args.costPerUnitKobo ?? 0;
    if (!Number.isFinite(quantity)) throw new Error("Enter a valid opening quantity");
    if (!Number.isFinite(lowStockLevel) || lowStockLevel < 0) throw new Error("Low-stock level cannot be negative");
    if (!Number.isFinite(costPerUnitKobo) || costPerUnitKobo < 0) throw new Error("Enter a valid unit cost");
    const ingredientId = await ctx.db.insert("ingredients", { name, unit, quantity, lowStockLevel, costPerUnitKobo, active: true });
    if (quantity !== 0) {
      await ctx.db.insert("inventoryMovements", { ingredientId, type: "adjustment", quantityDelta: quantity, balanceAfter: quantity, note: "Opening stock", createdAt: Date.now() });
    }
    return { ingredientId };
  },
});

export const updateIngredient = mutation({
  args: {
    ingredientId: v.id("ingredients"),
    name: v.string(),
    unit: v.string(),
    lowStockLevel: v.number(),
    costPerUnitKobo: v.number(),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager");
    const ingredient = await ctx.db.get(args.ingredientId);
    if (!ingredient) throw new Error("Ingredient not found");
    const name = await assertIngredientNameFree(ctx, args.name, args.ingredientId);
    const unit = args.unit.trim();
    if (!unit) throw new Error("Enter a unit (for example kg or litre)");
    if (!Number.isFinite(args.lowStockLevel) || args.lowStockLevel < 0) throw new Error("Low-stock level cannot be negative");
    if (!Number.isFinite(args.costPerUnitKobo) || args.costPerUnitKobo < 0) throw new Error("Enter a valid unit cost");
    await ctx.db.patch(args.ingredientId, { name, unit, lowStockLevel: args.lowStockLevel, costPerUnitKobo: args.costPerUnitKobo, active: args.active });
    return { ingredientId: args.ingredientId };
  },
});

export const deleteIngredient = mutation({
  args: { ingredientId: v.id("ingredients") },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager");
    const ingredient = await ctx.db.get(args.ingredientId);
    if (!ingredient) throw new Error("Ingredient not found");
    const [recipes, purchaseLines, movements] = await Promise.all([
      ctx.db.query("recipes").withIndex("by_ingredientId", (q) => q.eq("ingredientId", args.ingredientId)).take(1),
      ctx.db.query("purchaseItems").withIndex("by_ingredientId", (q) => q.eq("ingredientId", args.ingredientId)).take(1),
      ctx.db.query("inventoryMovements").withIndex("by_ingredientId_and_createdAt", (q) => q.eq("ingredientId", args.ingredientId)).take(1),
    ]);
    if (recipes.length) throw new Error("Remove this ingredient from its recipes before deleting it");
    if (purchaseLines.length || movements.length) throw new Error("This ingredient has stock history. Mark it inactive instead of deleting it");
    await ctx.db.delete(args.ingredientId);
    return { ingredientId: args.ingredientId };
  },
});
