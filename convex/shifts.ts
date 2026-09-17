import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireRole } from "./authz";

type Shift = Doc<"shifts">;

async function computeExpectedCash(ctx: import("./_generated/server").QueryCtx, shift: Shift) {
  const [cashPayments, cashRefunds, cashExpenses, cashPurchases] = await Promise.all([
    ctx.db.query("payments").withIndex("by_shiftId", (q) => q.eq("shiftId", shift._id)).take(500),
    ctx.db.query("refunds").withIndex("by_shiftId", (q) => q.eq("shiftId", shift._id)).take(500),
    ctx.db.query("expenses").withIndex("by_shiftId", (q) => q.eq("shiftId", shift._id)).take(500),
    ctx.db.query("purchases").withIndex("by_shiftId", (q) => q.eq("shiftId", shift._id)).take(500),
  ]);
  const cashPaidKobo = cashPayments.filter((payment) => payment.method === "cash").reduce((sum, payment) => sum + payment.amountKobo, 0);
  const cashRefundedKobo = cashRefunds.filter((refund) => refund.method === "cash").reduce((sum, refund) => sum + refund.amountKobo, 0);
  const cashExpensesKobo = cashExpenses.filter((expense) => expense.paymentMethod === "cash").reduce((sum, expense) => sum + expense.amountKobo, 0);
  const cashPurchasesKobo = cashPurchases.filter((purchase) => purchase.paymentMethod === "cash").reduce((sum, purchase) => sum + purchase.totalKobo, 0);
  const expectedCashKobo = shift.openingCashKobo + cashPaidKobo - cashRefundedKobo - cashExpensesKobo - cashPurchasesKobo;
  return { cashPaidKobo, cashRefundedKobo, cashExpensesKobo, cashPurchasesKobo, expectedCashKobo };
}

// Mirrors the expected-cash math used by computeExpectedCash so close uses the same snapshot.
async function expectedCashForShift(ctx: import("./_generated/server").MutationCtx, shiftId: Id<"shifts">) {
  return computeExpectedCash(ctx as import("./_generated/server").QueryCtx, (await ctx.db.get(shiftId)) as Shift);
}

export const current = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, "owner", "manager", "cashier");
    const shift = await ctx.db.query("shifts").withIndex("by_status", (q) => q.eq("status", "open")).unique();
    if (!shift) return null;
    return { ...shift, ...(await computeExpectedCash(ctx, shift)) };
  },
});

export const recentClosed = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, "owner", "manager");
    return ctx.db.query("shifts").withIndex("by_status", (q) => q.eq("status", "closed")).order("desc").take(20);
  },
});

export const report = query({
  args: { shiftId: v.id("shifts") },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager", "cashier");
    const shift = await ctx.db.get(args.shiftId);
    if (!shift) throw new Error("Shift not found");
    const breakdown = await computeExpectedCash(ctx, shift);
    const closer = shift.closedBy ? await ctx.db.get(shift.closedBy) : null;
    return { ...shift, ...breakdown, closerName: closer?.name ?? null };
  },
});

export const open = mutation({
  args: { openingCashKobo: v.number() },
  handler: async (ctx, args) => {
    await requireRole(ctx, "owner", "manager", "cashier");
    if (!Number.isFinite(args.openingCashKobo) || args.openingCashKobo < 0) throw new Error("Opening cash cannot be negative");
    const openShift = await ctx.db.query("shifts").withIndex("by_status", (q) => q.eq("status", "open")).unique();
    if (openShift) throw new Error("A shift is already open");
    const shiftId = await ctx.db.insert("shifts", { status: "open", openingCashKobo: args.openingCashKobo, expectedCashKobo: args.openingCashKobo, openedAt: Date.now() });
    return { shiftId };
  },
});

export const close = mutation({
  args: { shiftId: v.id("shifts"), countedCashKobo: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const staff = await requireRole(ctx, "owner", "manager", "cashier");
    if (!Number.isFinite(args.countedCashKobo) || args.countedCashKobo < 0) throw new Error("Counted cash cannot be negative");
    const shift = await ctx.db.get(args.shiftId);
    if (!shift || shift.status !== "open") throw new Error("This shift is not open");
    const { expectedCashKobo } = await expectedCashForShift(ctx, shift._id);
    const differenceKobo = args.countedCashKobo - expectedCashKobo;
    const note = args.note?.trim();
    if (differenceKobo !== 0 && !note) throw new Error("Add a note explaining the cash difference.");
    await ctx.db.patch(shift._id, { status: "closed", expectedCashKobo, countedCashKobo: args.countedCashKobo, differenceKobo, note: note || undefined, closedBy: staff._id, closedAt: Date.now() });
    return { expectedCashKobo, differenceKobo };
  },
});
