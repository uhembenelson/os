import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireRole } from "./authz";

type MoneyContext = QueryCtx | MutationCtx;

async function isPurchaseEditable(ctx: MoneyContext, purchase: { shiftId?: Id<"shifts"> }) {
  if (!purchase.shiftId) return true;
  const openShift = await ctx.db.query("shifts").withIndex("by_status", (q) => q.eq("status", "open")).unique();
  return openShift?._id === purchase.shiftId;
}

async function requireEditablePurchase(ctx: MoneyContext, purchase: { shiftId?: Id<"shifts"> }) {
  if (!await isPurchaseEditable(ctx, purchase)) throw new Error("This purchase belongs to a closed shift and can no longer be changed.");
}

export const recentExpenses = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, "owner", "manager");
    return ctx.db.query("expenses").withIndex("by_createdAt").order("desc").take(50);
  },
});

export const recentPurchases = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, "owner", "manager");
    return ctx.db.query("purchases").withIndex("by_createdAt").order("desc").take(50);
  },
});

export const purchaseLines = query({
  args: { purchaseId: v.id("purchases") },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager");
    const purchase = await ctx.db.get(args.purchaseId);
    if (!purchase) throw new Error("Purchase not found");
    const lines = await ctx.db.query("purchaseItems").withIndex("by_purchaseId", (q) => q.eq("purchaseId", args.purchaseId)).take(100);
    const detailed = await Promise.all(lines.map(async (line) => {
      const ingredient = await ctx.db.get(line.ingredientId);
      return { ...line, ingredientName: ingredient?.name ?? "Ingredient", unit: ingredient?.unit ?? "" };
    }));
    return { purchase, lines: detailed, editable: await isPurchaseEditable(ctx, purchase) };
  },
});

export const purchasesBySupplier = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager");
    const purchases = await ctx.db.query("purchases").withIndex("by_createdAt", (q) => q.gte("createdAt", args.from).lt("createdAt", args.to)).take(500);
    const groups = new Map<string, { supplier: string | null; totalKobo: number; count: number; lastAt: number }>();
    for (const purchase of purchases) {
      const name = purchase.supplier?.trim() || null;
      const key = name ?? "";
      const group = groups.get(key) ?? { supplier: name, totalKobo: 0, count: 0, lastAt: 0 };
      group.totalKobo += purchase.totalKobo;
      group.count += 1;
      group.lastAt = Math.max(group.lastAt, purchase.createdAt);
      groups.set(key, group);
    }
    return Array.from(groups.values()).sort((a, b) => b.totalKobo - a.totalKobo);
  },
});

export const summary = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager");
    const payments = await ctx.db.query("payments").withIndex("by_createdAt", (q) => q.gte("createdAt", args.from).lt("createdAt", args.to)).take(500);
    const refunds = await ctx.db.query("refunds").withIndex("by_createdAt", (q) => q.gte("createdAt", args.from).lt("createdAt", args.to)).take(500);
    const expenses = await ctx.db.query("expenses").withIndex("by_createdAt", (q) => q.gte("createdAt", args.from).lt("createdAt", args.to)).take(500);
    const purchases = await ctx.db.query("purchases").withIndex("by_createdAt", (q) => q.gte("createdAt", args.from).lt("createdAt", args.to)).take(500);
    const orders = await ctx.db.query("orders").withIndex("by_createdAt", (q) => q.gte("createdAt", args.from).lt("createdAt", args.to)).take(500);
    const collectedKobo = payments.reduce((sum, payment) => sum + payment.amountKobo, 0);
    const refundedKobo = refunds.reduce((sum, refund) => sum + refund.amountKobo, 0);
    const foodCostKobo = orders.filter((order) => order.status !== "cancelled" && order.foodCostKobo)
      .reduce((sum, order) => sum + (order.foodCostKobo ?? 0), 0);
    const expensesKobo = expenses.reduce((sum, expense) => sum + expense.amountKobo, 0);
    return {
      orderCount: orders.length,
      collectedKobo,
      refundedKobo,
      netCollectedKobo: collectedKobo - refundedKobo,
      cashKobo: payments.filter((payment) => payment.method === "cash").reduce((sum, payment) => sum + payment.amountKobo, 0),
      cardKobo: payments.filter((payment) => payment.method === "card").reduce((sum, payment) => sum + payment.amountKobo, 0),
      transferKobo: payments.filter((payment) => payment.method === "transfer").reduce((sum, payment) => sum + payment.amountKobo, 0),
      expensesKobo,
      purchasesKobo: purchases.reduce((sum, purchase) => sum + purchase.totalKobo, 0),
      foodCostKobo,
      estimatedProfitKobo: collectedKobo - refundedKobo - foodCostKobo - expensesKobo,
    };
  },
});

export const addExpense = mutation({
  args: {
    description: v.string(),
    amountKobo: v.number(),
    paymentMethod: v.union(v.literal("cash"), v.literal("card"), v.literal("transfer")),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager");
    const description = args.description.trim();
    if (!description) throw new Error("Add a description for this expense");
    if (!Number.isFinite(args.amountKobo) || args.amountKobo <= 0) throw new Error("Expense amount must be greater than zero");
    const openShift = await ctx.db.query("shifts").withIndex("by_status", (q) => q.eq("status", "open")).unique();
    const expenseId = await ctx.db.insert("expenses", { description, amountKobo: args.amountKobo, paymentMethod: args.paymentMethod, shiftId: openShift?._id, createdAt: Date.now() });
    return { expenseId };
  },
});

export const receivePurchase = mutation({
  args: {
    supplier: v.optional(v.string()),
    note: v.optional(v.string()),
    paymentMethod: v.union(v.literal("cash"), v.literal("card"), v.literal("transfer")),
    items: v.array(v.object({ ingredientId: v.id("ingredients"), quantity: v.number(), unitCostKobo: v.number() })),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager");
    if (!args.items.length) throw new Error("Add at least one ingredient to the purchase");
    const totalKobo = args.items.reduce((sum, item) => sum + item.quantity * item.unitCostKobo, 0);
    if (!Number.isFinite(totalKobo) || totalKobo <= 0) throw new Error("Purchase total must be greater than zero");
    for (const item of args.items) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error("Purchase quantities must be greater than zero");
      if (!Number.isFinite(item.unitCostKobo) || item.unitCostKobo < 0) throw new Error("Enter a valid unit cost");
      if (!await ctx.db.get(item.ingredientId)) throw new Error("A purchase ingredient no longer exists");
    }

    const createdAt = Date.now();
    const openShift = await ctx.db.query("shifts").withIndex("by_status", (q) => q.eq("status", "open")).unique();
    const purchaseId = await ctx.db.insert("purchases", { supplier: args.supplier?.trim() || undefined, note: args.note?.trim() || undefined, totalKobo, paymentMethod: args.paymentMethod, shiftId: openShift?._id, createdAt });
    for (const item of args.items) {
      const ingredient = await ctx.db.get(item.ingredientId);
      if (!ingredient) throw new Error("Ingredient not found");
      const balanceAfter = ingredient.quantity + item.quantity;
      const existingValueKobo = ingredient.quantity * (ingredient.costPerUnitKobo ?? 0);
      const weightedAverageKobo = (existingValueKobo + item.quantity * item.unitCostKobo) / balanceAfter;
      await ctx.db.patch(ingredient._id, { quantity: balanceAfter, costPerUnitKobo: weightedAverageKobo });
      await ctx.db.insert("purchaseItems", { purchaseId, ingredientId: ingredient._id, quantity: item.quantity, unitCostKobo: item.unitCostKobo, totalKobo: item.quantity * item.unitCostKobo });
      await ctx.db.insert("inventoryMovements", { ingredientId: ingredient._id, type: "receive", quantityDelta: item.quantity, balanceAfter, note: "Purchase received", createdAt });
    }
    return { purchaseId, totalKobo };
  },
});

export const addPurchaseItems = mutation({
  args: {
    purchaseId: v.id("purchases"),
    items: v.array(v.object({ ingredientId: v.id("ingredients"), quantity: v.number(), unitCostKobo: v.number() })),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager");
    if (!args.items.length) throw new Error("Add at least one ingredient to the purchase");
    const purchase = await ctx.db.get(args.purchaseId);
    if (!purchase) throw new Error("Purchase not found");
    await requireEditablePurchase(ctx, purchase);
    for (const item of args.items) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error("Purchase quantities must be greater than zero");
      if (!Number.isFinite(item.unitCostKobo) || item.unitCostKobo < 0) throw new Error("Enter a valid unit cost");
      if (!await ctx.db.get(item.ingredientId)) throw new Error("A purchase ingredient no longer exists");
    }

    const createdAt = Date.now();
    let addedKobo = 0;
    for (const item of args.items) {
      const ingredient = await ctx.db.get(item.ingredientId);
      if (!ingredient) throw new Error("Ingredient not found");
      const balanceAfter = ingredient.quantity + item.quantity;
      const existingValueKobo = ingredient.quantity * (ingredient.costPerUnitKobo ?? 0);
      const weightedAverageKobo = (existingValueKobo + item.quantity * item.unitCostKobo) / balanceAfter;
      await ctx.db.patch(ingredient._id, { quantity: balanceAfter, costPerUnitKobo: weightedAverageKobo });
      const lineKobo = item.quantity * item.unitCostKobo;
      await ctx.db.insert("purchaseItems", { purchaseId: purchase._id, ingredientId: ingredient._id, quantity: item.quantity, unitCostKobo: item.unitCostKobo, totalKobo: lineKobo });
      await ctx.db.insert("inventoryMovements", { ingredientId: ingredient._id, type: "receive", quantityDelta: item.quantity, balanceAfter, note: "Purchase item added", createdAt });
      addedKobo += lineKobo;
    }
    await ctx.db.patch(purchase._id, { totalKobo: purchase.totalKobo + addedKobo });
    return { purchaseId: purchase._id, addedKobo, totalKobo: purchase.totalKobo + addedKobo };
  },
});

export const removePurchase = mutation({
  args: { purchaseId: v.id("purchases") },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager");
    const purchase = await ctx.db.get(args.purchaseId);
    if (!purchase) throw new Error("Purchase not found");
    await requireEditablePurchase(ctx, purchase);
    const lines = await ctx.db.query("purchaseItems").withIndex("by_purchaseId", (q) => q.eq("purchaseId", purchase._id)).collect();
    const createdAt = Date.now();
    for (const line of lines) {
      const ingredient = await ctx.db.get(line.ingredientId);
      if (ingredient) {
        if (ingredient.quantity < line.quantity) throw new Error(`${ingredient.name} has already been used since this purchase. Adjust stock instead of removing the purchase.`);
        const balanceAfter = ingredient.quantity - line.quantity;
        const remainingValueKobo = ingredient.quantity * (ingredient.costPerUnitKobo ?? 0) - line.quantity * line.unitCostKobo;
        const nextCost = balanceAfter > 0 ? Math.max(0, remainingValueKobo / balanceAfter) : 0;
        await ctx.db.patch(ingredient._id, { quantity: balanceAfter, costPerUnitKobo: nextCost });
        await ctx.db.insert("inventoryMovements", { ingredientId: ingredient._id, type: "adjustment", quantityDelta: -line.quantity, balanceAfter, note: "Purchase removed", createdAt });
      }
      await ctx.db.delete(line._id);
    }
    await ctx.db.delete(purchase._id);
    return { purchaseId: purchase._id };
  },
});

export const removePurchaseItem = mutation({
  args: { lineId: v.id("purchaseItems") },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager");
    const line = await ctx.db.get(args.lineId);
    if (!line) throw new Error("Purchase item not found");
    const purchase = await ctx.db.get(line.purchaseId);
    if (!purchase) throw new Error("Purchase not found");
    await requireEditablePurchase(ctx, purchase);
    const ingredient = await ctx.db.get(line.ingredientId);
    if (ingredient) {
      if (ingredient.quantity < line.quantity) throw new Error(`${ingredient.name} has already been used since this purchase. Adjust stock instead of removing the item.`);
      const balanceAfter = ingredient.quantity - line.quantity;
      const remainingValueKobo = ingredient.quantity * (ingredient.costPerUnitKobo ?? 0) - line.quantity * line.unitCostKobo;
      const nextCost = balanceAfter > 0 ? Math.max(0, remainingValueKobo / balanceAfter) : 0;
      await ctx.db.patch(ingredient._id, { quantity: balanceAfter, costPerUnitKobo: nextCost });
      await ctx.db.insert("inventoryMovements", { ingredientId: ingredient._id, type: "adjustment", quantityDelta: -line.quantity, balanceAfter, note: "Purchase item removed", createdAt: Date.now() });
    }
    await ctx.db.delete(line._id);
    const totalKobo = Math.max(0, purchase.totalKobo - line.totalKobo);
    await ctx.db.patch(purchase._id, { totalKobo });
    return { purchaseId: purchase._id, totalKobo };
  },
});

export const updatePurchaseItem = mutation({
  args: { lineId: v.id("purchaseItems"), quantity: v.number(), unitCostKobo: v.number() },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager");
    if (!Number.isFinite(args.quantity) || args.quantity <= 0) throw new Error("Purchase quantities must be greater than zero");
    if (!Number.isFinite(args.unitCostKobo) || args.unitCostKobo < 0) throw new Error("Enter a valid unit cost");
    const line = await ctx.db.get(args.lineId);
    if (!line) throw new Error("Purchase item not found");
    const purchase = await ctx.db.get(line.purchaseId);
    if (!purchase) throw new Error("Purchase not found");
    await requireEditablePurchase(ctx, purchase);
    const ingredient = await ctx.db.get(line.ingredientId);
    if (!ingredient) throw new Error("Ingredient not found");
    if (ingredient.quantity < line.quantity) throw new Error(`${ingredient.name} has already been used since this purchase. Adjust stock instead of editing the item.`);

    const revertedQty = ingredient.quantity - line.quantity;
    const revertedValueKobo = ingredient.quantity * (ingredient.costPerUnitKobo ?? 0) - line.quantity * line.unitCostKobo;
    const balanceAfter = revertedQty + args.quantity;
    const averageKobo = revertedQty > 0 ? (revertedValueKobo + args.quantity * args.unitCostKobo) / balanceAfter : args.unitCostKobo;
    const lineKobo = args.quantity * args.unitCostKobo;
    await ctx.db.patch(ingredient._id, { quantity: balanceAfter, costPerUnitKobo: Math.max(0, averageKobo) });
    await ctx.db.patch(line._id, { quantity: args.quantity, unitCostKobo: args.unitCostKobo, totalKobo: lineKobo });
    await ctx.db.insert("inventoryMovements", { ingredientId: ingredient._id, type: "adjustment", quantityDelta: args.quantity - line.quantity, balanceAfter, note: "Purchase item updated", createdAt: Date.now() });
    const totalKobo = Math.max(0, purchase.totalKobo - line.totalKobo + lineKobo);
    await ctx.db.patch(purchase._id, { totalKobo });
    return { purchaseId: purchase._id, totalKobo };
  },
});
