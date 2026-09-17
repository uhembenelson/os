import { test, expect, describe } from "vitest";
import { asOwner, createStaffAsOwner, newT, seedIngredient, seedRecipe, type Ctx, type Owned } from "./testHelp";
import { api } from "./_generated/api";

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedDish(t: Ctx, name: string, key: string, priceKobo: number, costPerUnitKobo: number, recipeQuantity: number) {
  const itemId = await t.run(async (ctx) => ctx.db.insert("menuItems", { name, priceKobo, category: "Mains", key, active: true, sortOrder: 0 }));
  const ingredientId = await seedIngredient(t, `${name} stock`, 100, costPerUnitKobo, "kg");
  await seedRecipe(t, itemId, ingredientId, recipeQuantity);
  return itemId;
}

async function sell(ownerT: Owned, items: { key: string; name: string; quantity: number; unitPriceKobo: number }[], method: "cash" | "card" | "transfer") {
  const total = items.reduce((sum, item) => sum + item.quantity * item.unitPriceKobo, 0);
  const { orderId } = await ownerT.mutation(api.orders.create, {
    clientRequestId: `rpt-${Math.random()}`,
    orderType: "takeaway",
    deliveryFeeKobo: 0,
    packagingFeeKobo: 0,
    items,
  });
  await ownerT.mutation(api.orders.markPaid, { orderId, paymentMethod: method, amountTenderedKobo: total });
  return orderId;
}

describe("reports.salesReport", () => {
  test("computes net sales, orders, average order, food cost and estimated profit", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await ownerT.mutation(api.shifts.open, { openingCashKobo: 0 });
    await seedDish(t, "Rice", "rice", 50000, 4000, 0.2);
    await sell(ownerT, [{ key: "rice", name: "Rice", quantity: 2, unitPriceKobo: 50000 }], "cash");
    await ownerT.mutation(api.money.addExpense, { description: "Cleaning", amountKobo: 10000, paymentMethod: "cash" });

    const report = await ownerT.query(api.reports.salesReport, { from: 0, to: Date.now() + 60000 });
    expect(report.netSalesKobo).toBe(100000);
    expect(report.orderCount).toBe(1);
    expect(report.averageOrderKobo).toBe(100000);
    expect(report.foodCostKobo).toBeCloseTo(2 * 0.2 * 4000);
    expect(report.foodCostPct).toBeCloseTo((2 * 0.2 * 4000) / 100000 * 100);
    expect(report.estimatedProfitKobo).toBeCloseTo(100000 - 2 * 0.2 * 4000 - 10000);
  });

  test("splits payments by method and lists refunds", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await ownerT.mutation(api.shifts.open, { openingCashKobo: 0 });
    await seedDish(t, "Rice", "rice", 50000, 4000, 0.2);
    await sell(ownerT, [{ key: "rice", name: "Rice", quantity: 1, unitPriceKobo: 50000 }], "cash");
    await sell(ownerT, [{ key: "rice", name: "Rice", quantity: 1, unitPriceKobo: 30000 }], "card");
    const transferOrderId = await sell(ownerT, [{ key: "rice", name: "Rice", quantity: 1, unitPriceKobo: 20000 }], "transfer");
    await ownerT.mutation(api.orders.refund, { orderId: transferOrderId, amountKobo: 10000, method: "cash" });

    const report = await ownerT.query(api.reports.paymentReport, { from: 0, to: Date.now() + 60000 });
    expect(report.cashKobo).toBe(50000);
    expect(report.cardKobo).toBe(30000);
    expect(report.transferKobo).toBe(20000);
    expect(report.otherKobo).toBe(0);
    expect(report.refundedKobo).toBe(10000);
  });
});

describe("reports.salesSeries", () => {
  test("buckets net sales and orders by day relative to the range start", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await ownerT.mutation(api.shifts.open, { openingCashKobo: 0 });
    await seedDish(t, "Rice", "rice", 50000, 4000, 0.2);
    const now = Date.now();
    await sell(ownerT, [{ key: "rice", name: "Rice", quantity: 2, unitPriceKobo: 50000 }], "cash");

    const from = now - 2 * DAY_MS;
    const to = now + DAY_MS;
    const series = await ownerT.query(api.reports.salesSeries, { from, to });
    expect(series).toHaveLength(3);
    expect(series[0].salesKobo).toBe(0);
    expect(series[0].orders).toBe(0);
    expect(series[2].salesKobo).toBe(100000);
    expect(series[2].orders).toBe(1);
    expect(series[2].at).toBe(from + 2 * DAY_MS);
  });
});

describe("reports.weeklyComparison", () => {
  test("compares the current window with the previous equal window", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await ownerT.mutation(api.shifts.open, { openingCashKobo: 0 });
    await seedDish(t, "Rice", "rice", 50000, 4000, 0.2);
    const orderId = await sell(ownerT, [{ key: "rice", name: "Rice", quantity: 2, unitPriceKobo: 50000 }], "cash");

    const from = Date.now() - 6 * DAY_MS;
    const to = Date.now() + 60000;
    const before = await ownerT.query(api.reports.weeklyComparison, { from, to });
    expect(before.currentKobo).toBe(100000);
    expect(before.previousKobo).toBe(0);
    expect(before.changePct).toBeNull();

    await t.run(async (ctx) => ctx.db.insert("payments", { orderId, method: "cash", amountKobo: 50000, amountTenderedKobo: 50000, changeKobo: 0, createdAt: from - DAY_MS }));
    const after = await ownerT.query(api.reports.weeklyComparison, { from, to });
    expect(after.previousKobo).toBe(50000);
    expect(after.changeKobo).toBe(50000);
    expect(after.changePct).toBeCloseTo(100);
  });
});

describe("reports.topItems", () => {
  test("ranks items by quantity and ignores cancelled orders", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await ownerT.mutation(api.shifts.open, { openingCashKobo: 0 });
    await seedDish(t, "Rice", "rice", 50000, 4000, 0.2);
    await seedDish(t, "Chicken", "chicken", 70000, 5000, 0.3);
    await sell(ownerT, [{ key: "rice", name: "Rice", quantity: 3, unitPriceKobo: 50000 }], "cash");
    await sell(ownerT, [{ key: "chicken", name: "Chicken", quantity: 5, unitPriceKobo: 70000 }], "cash");
    const cancelled = await sell(ownerT, [{ key: "chicken", name: "Chicken", quantity: 10, unitPriceKobo: 70000 }], "cash");
    await t.run(async (ctx) => ctx.db.patch(cancelled, { status: "cancelled" }));

    const top = await ownerT.query(api.reports.topItems, { from: 0, to: Date.now() + 60000 });
    expect(top).toHaveLength(2);
    expect(top[0].name).toBe("Chicken");
    expect(top[0].quantity).toBe(5);
    expect(top[1].name).toBe("Rice");
    expect(top[1].quantity).toBe(3);
    expect(top[0].revenueKobo).toBe(5 * 70000);
  });
});

describe("reports access", () => {
  test("refuses cashiers", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const cashierT = await createStaffAsOwner(ownerT, t, "Cash", "+2348099999999", "111111", "cashier");
    await expect(cashierT.query(api.reports.salesReport, { from: 0, to: Date.now() })).rejects.toThrow("permission");
    await expect(cashierT.query(api.reports.topItems, { from: 0, to: Date.now() })).rejects.toThrow("permission");
  });
});
