import { test, expect, describe } from "vitest";
import { asOwner, createStaffAsOwner, newT, type Ctx, type Owned } from "./testHelp";
import { api } from "./_generated/api";

async function openAndPay(t: Ctx, ownerT: Owned, method: "cash" | "card" | "transfer" = "cash") {
  const { shiftId } = await ownerT.mutation(api.shifts.open, { openingCashKobo: 100000 });
  const { orderId } = await ownerT.mutation(api.orders.create, {
    clientRequestId: `pay-${method}-${Math.random()}`,
    orderType: "takeaway",
    deliveryFeeKobo: 0,
    packagingFeeKobo: 0,
    items: [{ key: "nokey", name: "Plain", quantity: 1, unitPriceKobo: 50000 }],
  });
  await ownerT.mutation(api.orders.markPaid, { orderId, paymentMethod: method, amountTenderedKobo: 50000 });
  const current = await ownerT.query(api.shifts.current, {});
  return { shiftId, current, orderId };
}

describe("shifts.open", () => {
  test("opens with the expected cash equal to the opening amount", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { shiftId } = await ownerT.mutation(api.shifts.open, { openingCashKobo: 250000 });
    const shift = await t.run(async (ctx) => ctx.db.get(shiftId));
    expect(shift?.expectedCashKobo).toBe(250000);
  });

  test("rejects negative opening cash and double-open", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await expect(ownerT.mutation(api.shifts.open, { openingCashKobo: -1 })).rejects.toThrow("cannot be negative");
    await ownerT.mutation(api.shifts.open, { openingCashKobo: 0 });
    await expect(ownerT.mutation(api.shifts.open, { openingCashKobo: 0 })).rejects.toThrow("A shift is already open");
  });

  test("kitchen staff cannot open a shift", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const kitchenT = await createStaffAsOwner(ownerT, t, "Kofi", "08095555555", "333333", "kitchen");
    await expect(kitchenT.mutation(api.shifts.open, { openingCashKobo: 0 })).rejects.toThrow("do not have permission");
  });
});

describe("expected cash math", () => {
  test("a cash payment increases expected cash but a card payment does not", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await ownerT.mutation(api.shifts.open, { openingCashKobo: 100000 });
    const { result: cashResult } = await paidOrder(ownerT, "cash", 20000);
    await cashResult;
    const { result: cardResult } = await paidOrder(ownerT, "card", 30000);
    await cardResult;
    const current = await ownerT.query(api.shifts.current, {});
    expect(current?.expectedCashKobo).toBe(100000 + 20000);
    expect(current?.cashPaidKobo).toBe(20000);
  });

  test("cash refunds and cash expenses reduce expected cash", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await ownerT.mutation(api.shifts.open, { openingCashKobo: 100000 });
    const order = await ownerT.mutation(api.orders.create, {
      clientRequestId: `refund-${Math.random()}`,
      orderType: "takeaway",
      deliveryFeeKobo: 0,
      packagingFeeKobo: 0,
      items: [{ key: "nokey", name: "Plain", quantity: 1, unitPriceKobo: 50000 }],
    });
    await ownerT.mutation(api.orders.markPaid, { orderId: order.orderId, paymentMethod: "cash", amountTenderedKobo: 50000 });
    await ownerT.mutation(api.orders.refund, { orderId: order.orderId, amountKobo: 50000, method: "cash" });
    await ownerT.mutation(api.money.addExpense, { description: "Cleaning", amountKobo: 15000, paymentMethod: "cash" });
    await ownerT.mutation(api.money.addExpense, { description: "Web hosting", amountKobo: 99900, paymentMethod: "card" });
    const current = await ownerT.query(api.shifts.current, {});
    expect(current?.expectedCashKobo).toBe(100000 + 50000 - 50000 - 15000);
  });

  test("a cash purchase reduces expected cash but the cost is not double-counted in profit", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await ownerT.mutation(api.shifts.open, { openingCashKobo: 100000 });
    const ingredientId = await t.run(async (ctx) => ctx.db.insert("ingredients", { name: "Rice", unit: "kg", quantity: 0, lowStockLevel: 0, active: true }));
    await ownerT.mutation(api.money.receivePurchase, {
      supplier: "Market",
      paymentMethod: "cash",
      items: [{ ingredientId, quantity: 10, unitCostKobo: 40000 }],
    });
    await ownerT.mutation(api.money.receivePurchase, {
      supplier: "Supplier",
      paymentMethod: "transfer",
      items: [{ ingredientId, quantity: 5, unitCostKobo: 41000 }],
    });
    const current = await ownerT.query(api.shifts.current, {});
    expect(current?.expectedCashKobo).toBe(100000 - 400000);
    const ingredient = await t.run(async (ctx) => ctx.db.get(ingredientId));
    expect(ingredient?.quantity).toBe(15);
    expect(ingredient?.costPerUnitKobo).toBeCloseTo((10 * 40000 + 5 * 41000) / 15, 6);
  });
});

describe("shifts.close", () => {
  test("computes the difference against counted cash and blocks re-close", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { shiftId } = await openAndPay(t, ownerT, "cash");
    const beforeClose = await ownerT.query(api.shifts.current, {});
    const close = await ownerT.mutation(api.shifts.close, { shiftId, countedCashKobo: beforeClose!.expectedCashKobo - 5000, note: "Till short" });
    expect(close.differenceKobo).toBe(-5000);
    const closed = await t.run(async (ctx) => ctx.db.get(shiftId));
    expect(closed?.status).toBe("closed");
    expect(closed?.note).toBe("Till short");
    expect(closed?.closedBy).toBeTruthy();
    await expect(ownerT.mutation(api.shifts.close, { shiftId, countedCashKobo: 0 })).rejects.toThrow("not open");
  });

  test("requires a note when the drawer does not balance", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { shiftId } = await openAndPay(t, ownerT, "cash");
    const beforeClose = await ownerT.query(api.shifts.current, {});
    await expect(ownerT.mutation(api.shifts.close, { shiftId, countedCashKobo: beforeClose!.expectedCashKobo + 2000 })).rejects.toThrow("note explaining the cash difference");
    await expect(ownerT.mutation(api.shifts.close, { shiftId, countedCashKobo: beforeClose!.expectedCashKobo + 2000, note: "   " })).rejects.toThrow("note explaining the cash difference");
  });

  test("stores a balanced close without a note and reports the breakdown", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { shiftId } = await openAndPay(t, ownerT, "cash");
    const beforeClose = await ownerT.query(api.shifts.current, {});
    await ownerT.mutation(api.shifts.close, { shiftId, countedCashKobo: beforeClose!.expectedCashKobo });

    const report = await ownerT.query(api.shifts.report, { shiftId });
    expect(report.differenceKobo).toBe(0);
    expect(report.note).toBeUndefined();
    expect(report.closerName).toBe("Ada Owner");
    expect(report.cashPaidKobo).toBeGreaterThan(0);
    expect(report.expectedCashKobo).toBe(report.openingCashKobo + report.cashPaidKobo - report.cashRefundedKobo - report.cashExpensesKobo - report.cashPurchasesKobo);
  });

  test("rejects negative counted cash", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { shiftId } = await openAndPay(t, ownerT, "cash");
    await expect(ownerT.mutation(api.shifts.close, { shiftId, countedCashKobo: -1 })).rejects.toThrow("Counted cash cannot be negative");
  });
});

async function paidOrder(ownerT: Owned, method: "cash" | "card" | "transfer", priceKobo: number) {
  const order = await ownerT.mutation(api.orders.create, {
    clientRequestId: `po-${method}-${Math.random()}`,
    orderType: "takeaway",
    deliveryFeeKobo: 0,
    packagingFeeKobo: 0,
    items: [{ key: "nokey", name: "Plain", quantity: 1, unitPriceKobo: priceKobo }],
  });
  const result = ownerT.mutation(api.orders.markPaid, { orderId: order.orderId, paymentMethod: method, amountTenderedKobo: priceKobo });
  return { order, result };
}