import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./authz";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 62;

async function moneyInRange(ctx: import("./_generated/server").QueryCtx, from: number, to: number) {
  const [payments, refunds, expenses, orders] = await Promise.all([
    ctx.db.query("payments").withIndex("by_createdAt", (q) => q.gte("createdAt", from).lt("createdAt", to)).take(2000),
    ctx.db.query("refunds").withIndex("by_createdAt", (q) => q.gte("createdAt", from).lt("createdAt", to)).take(2000),
    ctx.db.query("expenses").withIndex("by_createdAt", (q) => q.gte("createdAt", from).lt("createdAt", to)).take(2000),
    ctx.db.query("orders").withIndex("by_createdAt", (q) => q.gte("createdAt", from).lt("createdAt", to)).take(2000),
  ]);
  const collectedKobo = payments.reduce((sum, payment) => sum + payment.amountKobo, 0);
  const refundedKobo = refunds.reduce((sum, refund) => sum + refund.amountKobo, 0);
  const liveOrders = orders.filter((order) => order.status !== "cancelled");
  const foodCostKobo = liveOrders.reduce((sum, order) => sum + (order.foodCostKobo ?? 0), 0);
  const expensesKobo = expenses.reduce((sum, expense) => sum + expense.amountKobo, 0);
  return { payments, refunds, orders, liveOrders, collectedKobo, refundedKobo, foodCostKobo, expensesKobo };
}

export const salesReport = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager");
    const { liveOrders, collectedKobo, refundedKobo, foodCostKobo, expensesKobo } = await moneyInRange(ctx, args.from, args.to);
    const netSalesKobo = collectedKobo - refundedKobo;
    const orderCount = liveOrders.length;
    return {
      netSalesKobo,
      collectedKobo,
      refundedKobo,
      orderCount,
      averageOrderKobo: orderCount > 0 ? netSalesKobo / orderCount : 0,
      foodCostKobo,
      foodCostPct: netSalesKobo > 0 ? (foodCostKobo / netSalesKobo) * 100 : 0,
      expensesKobo,
      estimatedProfitKobo: netSalesKobo - foodCostKobo - expensesKobo,
    };
  },
});

export const paymentReport = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager");
    const { payments, refundedKobo } = await moneyInRange(ctx, args.from, args.to);
    const sum = (method: "cash" | "card" | "transfer") => payments.filter((payment) => payment.method === method).reduce((total, payment) => total + payment.amountKobo, 0);
    return { cashKobo: sum("cash"), cardKobo: sum("card"), transferKobo: sum("transfer"), otherKobo: 0, refundedKobo };
  },
});

export const salesSeries = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager");
    const span = args.to - args.from;
    const dayCount = Math.min(MAX_DAYS, Math.max(1, Math.round(span / DAY_MS)));
    const { payments, refunds, liveOrders } = await moneyInRange(ctx, args.from, args.to);
    const buckets = Array.from({ length: dayCount }, (_, index) => ({ at: args.from + index * DAY_MS, salesKobo: 0, orders: 0 }));
    const bucketFor = (timestamp: number) => {
      const index = Math.floor((timestamp - args.from) / DAY_MS);
      return index >= 0 && index < dayCount ? buckets[index] : null;
    };
    for (const payment of payments) { const bucket = bucketFor(payment.createdAt); if (bucket) bucket.salesKobo += payment.amountKobo; }
    for (const refund of refunds) { const bucket = bucketFor(refund.createdAt); if (bucket) bucket.salesKobo -= refund.amountKobo; }
    for (const order of liveOrders) { const bucket = bucketFor(order.createdAt); if (bucket) bucket.orders += 1; }
    return buckets;
  },
});

export const weeklyComparison = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager");
    const span = args.to - args.from;
    const [current, previous] = await Promise.all([
      moneyInRange(ctx, args.from, args.to),
      moneyInRange(ctx, args.from - span, args.from),
    ]);
    const currentKobo = current.collectedKobo - current.refundedKobo;
    const previousKobo = previous.collectedKobo - previous.refundedKobo;
    const changeKobo = currentKobo - previousKobo;
    return {
      currentKobo,
      previousKobo,
      changeKobo,
      changePct: previousKobo !== 0 ? (changeKobo / Math.abs(previousKobo)) * 100 : null,
    };
  },
});

export const topItems = query({
  args: { from: v.number(), to: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager");
    const orders = await ctx.db.query("orders").withIndex("by_createdAt", (q) => q.gte("createdAt", args.from).lt("createdAt", args.to)).take(2000);
    const items = new Map<string, { name: string; quantity: number; revenueKobo: number }>();
    for (const order of orders) {
      if (order.status === "cancelled") continue;
      for (const line of order.items) {
        const key = line.key || line.name;
        const row = items.get(key) ?? { name: line.name, quantity: 0, revenueKobo: 0 };
        row.quantity += line.quantity;
        row.revenueKobo += line.quantity * line.unitPriceKobo;
        items.set(key, row);
      }
    }
    const limit = Math.min(50, Math.max(1, args.limit ?? 5));
    return Array.from(items.values()).sort((a, b) => b.quantity - a.quantity || b.revenueKobo - a.revenueKobo).slice(0, limit);
  },
});
