import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireRole, requireStaff } from "./authz";

type PaymentMethod = "cash" | "card" | "transfer";

export const active = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx);
    const [newOrders, preparingOrders, readyOrders] = await Promise.all([
      ctx.db.query("orders").withIndex("by_status", (q) => q.eq("status", "new")).order("asc").take(100),
      ctx.db.query("orders").withIndex("by_status", (q) => q.eq("status", "preparing")).order("asc").take(100),
      ctx.db.query("orders").withIndex("by_status", (q) => q.eq("status", "ready")).order("desc").take(100),
    ]);
    return [...newOrders, ...preparingOrders, ...readyOrders];
  },
});

export const unpaid = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, "owner", "manager", "cashier");
    return ctx.db.query("orders").withIndex("by_payment_status", (q) => q.eq("paymentStatus", "unpaid")).order("desc").take(100);
  },
});

export const recent = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, "owner", "manager", "cashier");
    return ctx.db.query("orders").order("desc").take(50);
  },
});

export const paymentSummary = query({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager", "cashier");
    const order = await ctx.db.get(args.orderId);
    if (!order) return null;
    const payments = await ctx.db.query("payments").withIndex("by_orderId", (q) => q.eq("orderId", order._id)).order("asc").take(100);
    const refunds = await ctx.db.query("refunds").withIndex("by_orderId", (q) => q.eq("orderId", order._id)).order("asc").take(100);
    const recordedPaidKobo = payments.reduce((sum, payment) => sum + payment.amountKobo, 0);
    // Orders created before the payment ledger stored only paymentStatus on the order.
    // Treat a legacy paid order as having collected its order total for reporting/refunds.
    const paidKobo = payments.length ? recordedPaidKobo : order.paymentStatus === "paid" ? order.totalKobo : 0;
    const refundedKobo = refunds.reduce((sum, refund) => sum + refund.amountKobo, 0);
    return { order, payments, refunds, paidKobo, refundedKobo, netPaidKobo: paidKobo - refundedKobo, remainingKobo: Math.max(0, order.totalKobo - paidKobo) };
  },
});

async function applyPayment(ctx: import("./_generated/server").MutationCtx, orderId: Id<"orders">, method: PaymentMethod, amountKobo: number, amountTenderedKobo: number) {
  const order = await ctx.db.get(orderId);
  if (!order) throw new Error("Order not found");
  if (order.paymentStatus !== "unpaid") throw new Error("This order cannot accept another payment");
  if (!Number.isFinite(amountKobo) || amountKobo <= 0) throw new Error("Payment amount must be greater than zero");

  const payments = await ctx.db.query("payments").withIndex("by_orderId", (q) => q.eq("orderId", orderId)).take(100);
  const paidKobo = payments.reduce((sum, payment) => sum + payment.amountKobo, 0);
  const remainingKobo = Math.max(0, order.totalKobo - paidKobo);
  if (remainingKobo <= 0) throw new Error("Order is already paid");
  if (amountKobo > remainingKobo) throw new Error("Payment cannot be greater than the remaining balance");
  if (method !== "cash" && amountTenderedKobo !== amountKobo) throw new Error("Card and transfer amounts must match the amount applied");
  if (method === "cash" && amountTenderedKobo < amountKobo) throw new Error("Amount received is less than the amount applied");

  const changeKobo = method === "cash" ? Math.max(0, amountTenderedKobo - amountKobo) : 0;
  const createdAt = Date.now();
  const openShift = await ctx.db.query("shifts").withIndex("by_status", (q) => q.eq("status", "open")).unique();
  const newPaidKobo = paidKobo + amountKobo;
  const newRemainingKobo = Math.max(0, order.totalKobo - newPaidKobo);
  await ctx.db.insert("payments", { orderId, shiftId: openShift?._id, method, amountKobo, amountTenderedKobo, changeKobo, createdAt });
  await ctx.db.patch(orderId, {
    paymentStatus: newRemainingKobo === 0 ? "paid" : "unpaid",
    paymentMethod: method,
    amountTenderedKobo,
    changeKobo,
    paidAt: createdAt,
  });
  return { number: order.number, totalKobo: order.totalKobo, appliedKobo: amountKobo, remainingKobo: newRemainingKobo, changeKobo, method };
}

export const create = mutation({
  args: {
    clientRequestId: v.string(),
    orderType: v.union(v.literal("dine-in"), v.literal("takeaway")),
    deliveryFeeKobo: v.number(),
    packagingFeeKobo: v.number(),
    items: v.array(v.object({
      key: v.string(),
      name: v.string(),
      quantity: v.number(),
      unitPriceKobo: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager", "cashier");
    const existingOrder = await ctx.db.query("orders").withIndex("by_clientRequestId", (q) => q.eq("clientRequestId", args.clientRequestId)).unique();
    if (existingOrder) return { orderId: existingOrder._id, number: existingOrder.number, totalKobo: existingOrder.totalKobo };

    const createdAt = Date.now();
    const itemTotalKobo = args.items.reduce((sum, item) => sum + item.unitPriceKobo * item.quantity, 0);
    const totalKobo = itemTotalKobo + args.deliveryFeeKobo + args.packagingFeeKobo;
    const number = `#${String(createdAt).slice(-4)}`;
    const orderId = await ctx.db.insert("orders", {
      number,
      status: "new",
      clientRequestId: args.clientRequestId,
      paymentStatus: "unpaid",
      orderType: args.orderType,
      items: args.items,
      deliveryFeeKobo: args.deliveryFeeKobo,
      packagingFeeKobo: args.packagingFeeKobo,
      totalKobo,
      createdAt,
    });

    const deductions = new Map<string, { ingredientId: Id<"ingredients">; quantity: number }>();
    let foodCostKobo = 0;
    for (const orderItem of args.items) {
      const menuItem = await ctx.db.query("menuItems").withIndex("by_key", (q) => q.eq("key", orderItem.key)).unique();
      if (!menuItem) continue;
      if (menuItem.active === false) throw new Error(`${orderItem.name} is no longer available.`);
      if (menuItem.soldOut === true) throw new Error(`${orderItem.name} was marked sold out.`);
      const recipeRows = await ctx.db.query("recipes").withIndex("by_menuItemId", (q) => q.eq("menuItemId", menuItem._id)).take(100);
      for (const recipeRow of recipeRows) {
        const key = recipeRow.ingredientId as string;
        const current = deductions.get(key);
        const quantity = recipeRow.quantity * orderItem.quantity;
        deductions.set(key, { ingredientId: recipeRow.ingredientId, quantity: (current?.quantity ?? 0) + quantity });
      }
      const ingredientCosts = await Promise.all(recipeRows.map((recipeRow) => ctx.db.get(recipeRow.ingredientId)));
      const unitFoodCostKobo = recipeRows.reduce((sum, recipeRow, index) => sum + recipeRow.quantity * (ingredientCosts[index]?.costPerUnitKobo ?? 0), 0);
      foodCostKobo += unitFoodCostKobo * orderItem.quantity;
    }

    for (const deduction of deductions.values()) {
      const ingredient = await ctx.db.get(deduction.ingredientId);
      if (!ingredient) throw new Error("A recipe ingredient no longer exists");
      const balanceAfter = ingredient.quantity - deduction.quantity;
      await ctx.db.patch(ingredient._id, { quantity: balanceAfter });
      await ctx.db.insert("inventoryMovements", {
        ingredientId: ingredient._id,
        type: "sale",
        quantityDelta: -deduction.quantity,
        balanceAfter,
        orderId,
        note: `Ingredients used for ${number}`,
        createdAt,
      });
    }

    if (foodCostKobo > 0) await ctx.db.patch(orderId, { foodCostKobo });

    return { orderId, number, totalKobo };
  },
});

export const markPaid = mutation({
  args: {
    orderId: v.id("orders"),
    paymentMethod: v.union(v.literal("cash"), v.literal("card"), v.literal("transfer")),
    amountTenderedKobo: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager", "cashier");
    const totalKobo = (await ctx.db.get(args.orderId))?.totalKobo ?? 0;
    const tenderedKobo = args.paymentMethod === "cash" ? (args.amountTenderedKobo ?? 0) : totalKobo;
    return await applyPayment(ctx, args.orderId, args.paymentMethod, totalKobo, tenderedKobo);
  },
});

export const addPayment = mutation({
  args: {
    orderId: v.id("orders"),
    paymentMethod: v.union(v.literal("cash"), v.literal("card"), v.literal("transfer")),
    amountKobo: v.number(),
    amountTenderedKobo: v.number(),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager", "cashier");
    return applyPayment(ctx, args.orderId, args.paymentMethod, args.amountKobo, args.amountTenderedKobo);
  },
});

export const refund = mutation({
  args: {
    orderId: v.id("orders"),
    amountKobo: v.number(),
    method: v.union(v.literal("cash"), v.literal("card"), v.literal("transfer")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager");
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.paymentStatus !== "paid") throw new Error("Only paid orders can be refunded");
    if (!Number.isFinite(args.amountKobo) || args.amountKobo <= 0) throw new Error("Refund amount must be greater than zero");

    const payments = await ctx.db.query("payments").withIndex("by_orderId", (q) => q.eq("orderId", order._id)).take(100);
    const refunds = await ctx.db.query("refunds").withIndex("by_orderId", (q) => q.eq("orderId", order._id)).take(100);
    const recordedPaidKobo = payments.reduce((sum, payment) => sum + payment.amountKobo, 0);
    const paidKobo = payments.length ? recordedPaidKobo : order.paymentStatus === "paid" ? order.totalKobo : 0;
    const refundedKobo = refunds.reduce((sum, refundRecord) => sum + refundRecord.amountKobo, 0);
    const refundableKobo = paidKobo - refundedKobo;
    if (args.amountKobo > refundableKobo) throw new Error(`Refund cannot exceed ${Math.round(refundableKobo / 100).toLocaleString("en-NG")} naira`);

    const createdAt = Date.now();
    const openShift = await ctx.db.query("shifts").withIndex("by_status", (q) => q.eq("status", "open")).unique();
    await ctx.db.insert("refunds", { orderId: order._id, amountKobo: args.amountKobo, method: args.method, shiftId: openShift?._id, reason: args.reason?.trim() || undefined, createdAt });
    await ctx.db.patch(order._id, { paymentStatus: args.amountKobo === refundableKobo ? "refunded" : "paid" });
    return { number: order.number, amountKobo: args.amountKobo, remainingRefundableKobo: refundableKobo - args.amountKobo };
  },
});

export const updateKitchenStatus = mutation({
  args: {
    orderId: v.id("orders"),
    nextStatus: v.union(v.literal("preparing"), v.literal("ready"), v.literal("completed")),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager", "cashier", "kitchen");
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");

    const allowedNextStatus = order.status === "new"
      ? "preparing"
      : order.status === "preparing"
        ? "ready"
        : order.status === "ready"
          ? "completed"
          : null;

    if (args.nextStatus !== allowedNextStatus) {
      throw new Error(`Order cannot move from ${order.status} to ${args.nextStatus}`);
    }

    const changedAt = Date.now();
    await ctx.db.patch(args.orderId, {
      status: args.nextStatus,
      ...(args.nextStatus === "preparing" ? { preparingAt: changedAt } : {}),
      ...(args.nextStatus === "ready" ? { readyAt: changedAt } : {}),
      ...(args.nextStatus === "completed" ? { completedAt: changedAt } : {}),
    });

    return { orderId: order._id, status: args.nextStatus };
  },
});

export const cancel = mutation({
  args: {
    orderId: v.id("orders"),
    inventoryHandling: v.union(v.literal("return"), v.literal("waste")),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager", "cashier");
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status === "completed" || order.status === "cancelled") throw new Error("This order can no longer be cancelled");
    if (order.paymentStatus === "paid") throw new Error("Paid orders must be refunded before cancellation");

    const createdAt = Date.now();
    const movements = await ctx.db.query("inventoryMovements").withIndex("by_orderId", (q) => q.eq("orderId", order._id)).take(100);
    for (const movement of movements) {
      if (movement.type !== "sale") continue;
      const ingredient = await ctx.db.get(movement.ingredientId);
      if (!ingredient) continue;
      const quantityDelta = Math.abs(movement.quantityDelta);
      const returnedBalance = ingredient.quantity + quantityDelta;

      await ctx.db.insert("inventoryMovements", {
        ingredientId: ingredient._id,
        type: "cancellation",
        quantityDelta,
        balanceAfter: returnedBalance,
        orderId: order._id,
        note: `Sale deduction reversed for cancelled ${order.number}`,
        createdAt,
      });
      await ctx.db.patch(ingredient._id, { quantity: returnedBalance });

      if (args.inventoryHandling === "waste") {
        await ctx.db.patch(ingredient._id, { quantity: ingredient.quantity });
        await ctx.db.insert("inventoryMovements", {
          ingredientId: ingredient._id,
          type: "waste",
          quantityDelta: -quantityDelta,
          balanceAfter: ingredient.quantity,
          orderId: order._id,
          note: `Ingredients wasted from cancelled ${order.number}`,
          createdAt,
        });
      }
    }

    await ctx.db.patch(order._id, { status: "cancelled", cancelledAt: createdAt, cancellationInventoryHandling: args.inventoryHandling });
    return { orderId: order._id, status: "cancelled" as const };
  },
});
