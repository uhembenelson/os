import { test, expect, describe } from "vitest";
import type { Id } from "./_generated/dataModel";
import { asOwner, newT, seedIngredient, seedRecipe } from "./testHelp";
import { api } from "./_generated/api";

describe("expenses", () => {
  test("records the expense with its payment method on the open shift", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await ownerT.mutation(api.shifts.open, { openingCashKobo: 0 });
    const { expenseId } = await ownerT.mutation(api.money.addExpense, { description: "Market run", amountKobo: 25000, paymentMethod: "cash" });
    const expense = await t.run(async (ctx) => ctx.db.get(expenseId));
    expect(expense?.paymentMethod).toBe("cash");
    expect(expense?.shiftId).toBeDefined();
    const shift = await ownerT.query(api.shifts.current, {});
    expect(shift?.cashExpensesKobo).toBe(25000);
  });

  test("rejects empty descriptions and non-positive amounts", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await expect(ownerT.mutation(api.money.addExpense, { description: "   ", amountKobo: 1000, paymentMethod: "cash" })).rejects.toThrow("description");
    await expect(ownerT.mutation(api.money.addExpense, { description: "X", amountKobo: 0, paymentMethod: "cash" })).rejects.toThrow("greater than zero");
  });
});

describe("expense types", () => {
  test("creates, lists, and records an expense tagged with a type", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await ownerT.mutation(api.money.addExpenseType, { name: "Transport" });
    const types = await ownerT.query(api.money.listExpenseTypes, {});
    expect(types.map((type) => type.name)).toEqual(["Transport"]);
    const { expenseId } = await ownerT.mutation(api.money.addExpense, { description: "Bus fare", type: "Transport", amountKobo: 1500, paymentMethod: "cash" });
    const expense = await t.run(async (ctx) => ctx.db.get(expenseId));
    expect(expense?.type).toBe("Transport");
  });

  test("rejects duplicate type names and unknown types", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await ownerT.mutation(api.money.addExpenseType, { name: "Fuel" });
    await expect(ownerT.mutation(api.money.addExpenseType, { name: "Fuel" })).rejects.toThrow("already exists");
    await expect(ownerT.mutation(api.money.addExpense, { description: "Tea", type: "Snacks", amountKobo: 500, paymentMethod: "cash" })).rejects.toThrow("expense type");
  });

  test("groups expenses by type over a range", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await ownerT.mutation(api.money.addExpenseType, { name: "Transport" });
    await ownerT.mutation(api.money.addExpenseType, { name: "Utilities" });
    await ownerT.mutation(api.money.addExpense, { description: "Fuel", type: "Transport", amountKobo: 4000, paymentMethod: "cash" });
    await ownerT.mutation(api.money.addExpense, { description: "Keke", type: "Transport", amountKobo: 1000, paymentMethod: "cash" });
    await ownerT.mutation(api.money.addExpense, { description: "Power", type: "Utilities", amountKobo: 2000, paymentMethod: "card" });
    await ownerT.mutation(api.money.addExpense, { description: "Untagged", amountKobo: 700, paymentMethod: "cash" });
    const rows = await ownerT.query(api.money.expensesByType, { from: 0, to: Date.now() + 1000 });
    expect(rows).toEqual([
      { type: "Transport", totalKobo: 5000, count: 2 },
      { type: "Utilities", totalKobo: 2000, count: 1 },
      { type: "Other", totalKobo: 700, count: 1 },
    ]);
  });

  test("removes a type without touching expenses already recorded with it", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { id } = await ownerT.mutation(api.money.addExpenseType, { name: "Rent" });
    const { expenseId } = await ownerT.mutation(api.money.addExpense, { description: "Shop rent", type: "Rent", amountKobo: 500000, paymentMethod: "transfer" });
    await ownerT.mutation(api.money.removeExpenseType, { id });
    expect(await ownerT.query(api.money.listExpenseTypes, {})).toEqual([]);
    const expense = await t.run(async (ctx) => ctx.db.get(expenseId));
    expect(expense?.type).toBe("Rent");
  });
});

describe("purchases", () => {
  test("increases stock, links the purchase lines, and updates the unit cost", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const ingredientId = await seedIngredient(t, "Rice", 2, 35000, "kg");
    const { purchaseId, totalKobo } = await ownerT.mutation(api.money.receivePurchase, {
      supplier: "Farm",
      note: "April restock",
      paymentMethod: "cash",
      items: [{ ingredientId, quantity: 3, unitCostKobo: 40000 }],
    });
    const ingredient = await t.run(async (ctx) => ctx.db.get(ingredientId));
    expect(ingredient?.quantity).toBe(5);
    expect(ingredient?.costPerUnitKobo).toBe(38000);
    expect(totalKobo).toBe(120000);
    const lines = await t.run(async (ctx) => ctx.db.query("purchaseItems").withIndex("by_purchaseId", (q) => q.eq("purchaseId", purchaseId)).collect());
    expect(lines).toHaveLength(1);
    expect(lines[0].totalKobo).toBe(120000);
    const movements = await t.run(async (ctx) => ctx.db.query("inventoryMovements").withIndex("by_ingredientId_and_createdAt", (q) => q.eq("ingredientId", ingredientId)).collect());
    expect(movements.filter((movement) => movement.type === "receive")).toHaveLength(1);
  });

  test("uses a weighted average so old stock cost is not discounted by new purchases", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const ingredientId = await seedIngredient(t, "Rice", 4, 4000, "kg");
    await ownerT.mutation(api.money.receivePurchase, {
      supplier: "Farm",
      paymentMethod: "card",
      items: [{ ingredientId, quantity: 3, unitCostKobo: 5000 }],
    });
    const ingredient = await t.run(async (ctx) => ctx.db.get(ingredientId));
    expect(ingredient?.quantity).toBe(7);
    expect(ingredient?.costPerUnitKobo).toBeCloseTo((4 * 4000 + 3 * 5000) / 7, 6);
  });

  test("sets the unit cost to the incoming cost when there is no prior stock", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const ingredientId = await seedIngredient(t, "Rice", 0, 0, "kg");
    await ownerT.mutation(api.money.receivePurchase, {
      supplier: "Farm",
      paymentMethod: "cash",
      items: [{ ingredientId, quantity: 5, unitCostKobo: 5000 }],
    });
    const ingredient = await t.run(async (ctx) => ctx.db.get(ingredientId));
    expect(ingredient?.quantity).toBe(5);
    expect(ingredient?.costPerUnitKobo).toBe(5000);
  });

  test("rejects invalid quantities and unknown ingredients", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const riceId = await seedIngredient(t, "Rice", 10, 35000, "kg");
    await expect(ownerT.mutation(api.money.receivePurchase, { paymentMethod: "cash", items: [] })).rejects.toThrow("at least one ingredient");
    await expect(ownerT.mutation(api.money.receivePurchase, { paymentMethod: "cash", items: [{ ingredientId: riceId, quantity: 2, unitCostKobo: 100 }, { ingredientId: riceId, quantity: -1, unitCostKobo: 100 }] })).rejects.toThrow("greater than zero");
    await expect(ownerT.mutation(api.money.receivePurchase, { paymentMethod: "cash", items: [{ ingredientId: "000000000000000000000010000ingredients" as Id<"ingredients">, quantity: 1, unitCostKobo: 100 }] })).rejects.toThrow("no longer exists");
  });
});

describe("summary", () => {
  test("estimated profit is net collected minus food cost minus expenses", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await ownerT.mutation(api.shifts.open, { openingCashKobo: 0 });
    const itemId = await t.run(async (ctx) => ctx.db.insert("menuItems", { name: "Rice", priceKobo: 50000, category: "Mains", key: "rice", active: true, sortOrder: 0 }));
    const riceId = await seedIngredient(t, "Rice", 10, 4000, "kg");
    await seedRecipe(t, itemId, riceId, 0.2);

    const { orderId } = await ownerT.mutation(api.orders.create, {
      clientRequestId: `sum-${Math.random()}`,
      orderType: "dine-in",
      deliveryFeeKobo: 0,
      packagingFeeKobo: 0,
      items: [{ key: "rice", name: "Rice", quantity: 2, unitPriceKobo: 50000 }],
    });
    await ownerT.mutation(api.orders.markPaid, { orderId, paymentMethod: "cash", amountTenderedKobo: 100000 });
    await ownerT.mutation(api.money.addExpense, { description: "Cleaning", amountKobo: 10000, paymentMethod: "cash" });

    const summary = await ownerT.query(api.money.summary, { from: 0, to: Date.now() + 60000 });
    expect(summary.collectedKobo).toBe(100000);
    expect(summary.foodCostKobo).toBeCloseTo(2 * 0.2 * 4000);
    expect(summary.expensesKobo).toBe(10000);
    expect(summary.estimatedProfitKobo).toBeCloseTo(100000 - 2 * 0.2 * 4000 - 10000);
  });

  test("refunds reduce net collected and purchases are displayed without double-counting profit", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await ownerT.mutation(api.shifts.open, { openingCashKobo: 0 });
    const riceId = await seedIngredient(t, "Rice", 0, 4000, "kg");

    const { orderId } = await ownerT.mutation(api.orders.create, {
      clientRequestId: `ref-${Math.random()}`,
      orderType: "takeaway",
      deliveryFeeKobo: 0,
      packagingFeeKobo: 0,
      items: [{ key: "nokey", name: "Plain", quantity: 1, unitPriceKobo: 50000 }],
    });
    await ownerT.mutation(api.orders.markPaid, { orderId, paymentMethod: "cash", amountTenderedKobo: 50000 });
    await ownerT.mutation(api.orders.refund, { orderId, amountKobo: 20000, method: "cash" });
    await ownerT.mutation(api.money.receivePurchase, { paymentMethod: "cash", items: [{ ingredientId: riceId, quantity: 4, unitCostKobo: 4000 }] });

    const summary = await ownerT.query(api.money.summary, { from: 0, to: Date.now() + 60000 });
    expect(summary.refundedKobo).toBe(20000);
    expect(summary.netCollectedKobo).toBe(30000);
    expect(summary.purchasesKobo).toBe(16000);
    expect(summary.estimatedProfitKobo).toBe(30000);
  });
});

describe("purchase history", () => {
  test("records a multi-line purchase and updates each ingredient's average cost", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const riceId = await seedIngredient(t, "Rice", 2, 3000, "kg");
    const oilId = await seedIngredient(t, "Oil", 0, 0, "litre");
    const { purchaseId, totalKobo } = await ownerT.mutation(api.money.receivePurchase, {
      supplier: "Oke Arin Market",
      note: "Weekly restock",
      paymentMethod: "transfer",
      items: [
        { ingredientId: riceId, quantity: 3, unitCostKobo: 4000 },
        { ingredientId: oilId, quantity: 5, unitCostKobo: 2000 },
      ],
    });
    expect(totalKobo).toBe(3 * 4000 + 5 * 2000);
    const rice = await t.run(async (ctx) => ctx.db.get(riceId));
    const oil = await t.run(async (ctx) => ctx.db.get(oilId));
    expect(rice?.quantity).toBe(5);
    expect(rice?.costPerUnitKobo).toBeCloseTo((2 * 3000 + 3 * 4000) / 5, 6);
    expect(oil?.quantity).toBe(5);
    expect(oil?.costPerUnitKobo).toBe(2000);
    const lines = await t.run(async (ctx) => ctx.db.query("purchaseItems").withIndex("by_purchaseId", (q) => q.eq("purchaseId", purchaseId)).collect());
    expect(lines).toHaveLength(2);
    const detail = await ownerT.query(api.money.purchaseLines, { purchaseId });
    expect(detail.lines).toHaveLength(2);
    expect(detail.lines.map((line) => line.ingredientName).sort()).toEqual(["Oil", "Rice"]);
    expect(detail.purchase.note).toBe("Weekly restock");
  });

  test("groups spend by supplier name for the period, including an unnamed bucket", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const riceId = await seedIngredient(t, "Rice", 0, 1000, "kg");
    await ownerT.mutation(api.money.receivePurchase, { supplier: "Farm", paymentMethod: "cash", items: [{ ingredientId: riceId, quantity: 1, unitCostKobo: 10000 }] });
    await ownerT.mutation(api.money.receivePurchase, { supplier: "Farm", paymentMethod: "cash", items: [{ ingredientId: riceId, quantity: 1, unitCostKobo: 5000 }] });
    await ownerT.mutation(api.money.receivePurchase, { supplier: "Market", paymentMethod: "cash", items: [{ ingredientId: riceId, quantity: 1, unitCostKobo: 20000 }] });
    await ownerT.mutation(api.money.receivePurchase, { paymentMethod: "cash", items: [{ ingredientId: riceId, quantity: 1, unitCostKobo: 1000 }] });

    const groups = await ownerT.query(api.money.purchasesBySupplier, { from: 0, to: Date.now() + 60000 });
    expect(groups).toHaveLength(3);
    expect(groups[0].supplier).toBe("Market");
    expect(groups[0].totalKobo).toBe(20000);
    const farm = groups.find((group) => group.supplier === "Farm");
    expect(farm?.totalKobo).toBe(15000);
    expect(farm?.count).toBe(2);
    const unnamed = groups.find((group) => group.supplier === null);
    expect(unnamed?.totalKobo).toBe(1000);
  });
});

describe("purchase editing", () => {
  test("adds a line to an existing purchase and updates total and average cost", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const riceId = await seedIngredient(t, "Rice", 4, 4000, "kg");
    const oilId = await seedIngredient(t, "Oil", 0, 0, "litre");
    const { purchaseId, totalKobo } = await ownerT.mutation(api.money.receivePurchase, { supplier: "Farm", paymentMethod: "cash", items: [{ ingredientId: riceId, quantity: 2, unitCostKobo: 5000 }] });
    expect(totalKobo).toBe(10000);

    const result = await ownerT.mutation(api.money.addPurchaseItems, { purchaseId, items: [{ ingredientId: oilId, quantity: 3, unitCostKobo: 2000 }] });
    expect(result.totalKobo).toBe(16000);
    const purchase = await t.run(async (ctx) => ctx.db.get(purchaseId));
    expect(purchase?.totalKobo).toBe(16000);
    const oil = await t.run(async (ctx) => ctx.db.get(oilId));
    expect(oil?.quantity).toBe(3);
    expect(oil?.costPerUnitKobo).toBe(2000);
    const lines = await t.run(async (ctx) => ctx.db.query("purchaseItems").withIndex("by_purchaseId", (q) => q.eq("purchaseId", purchaseId)).collect());
    expect(lines).toHaveLength(2);
  });

  test("removes a purchase, returns stock to its earlier average cost, and deletes its lines", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const riceId = await seedIngredient(t, "Rice", 4, 4000, "kg");
    const { purchaseId } = await ownerT.mutation(api.money.receivePurchase, { supplier: "Farm", paymentMethod: "cash", items: [{ ingredientId: riceId, quantity: 3, unitCostKobo: 5000 }] });

    await ownerT.mutation(api.money.removePurchase, { purchaseId });
    const rice = await t.run(async (ctx) => ctx.db.get(riceId));
    expect(rice?.quantity).toBe(4);
    expect(rice?.costPerUnitKobo).toBeCloseTo(4000, 6);
    expect(await t.run(async (ctx) => ctx.db.get(purchaseId))).toBeNull();
    const lines = await t.run(async (ctx) => ctx.db.query("purchaseItems").withIndex("by_purchaseId", (q) => q.eq("purchaseId", purchaseId)).collect());
    expect(lines).toHaveLength(0);
    const movements = await t.run(async (ctx) => ctx.db.query("inventoryMovements").withIndex("by_ingredientId_and_createdAt", (q) => q.eq("ingredientId", riceId)).collect());
    expect(movements.some((movement) => movement.type === "adjustment" && movement.quantityDelta === -3)).toBe(true);
  });

  test("refuses to remove a purchase whose stock was already consumed", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const riceId = await seedIngredient(t, "Rice", 0, 0, "kg");
    const { purchaseId } = await ownerT.mutation(api.money.receivePurchase, { paymentMethod: "cash", items: [{ ingredientId: riceId, quantity: 5, unitCostKobo: 1000 }] });
    await t.run(async (ctx) => ctx.db.patch(riceId, { quantity: 2 }));
    await expect(ownerT.mutation(api.money.removePurchase, { purchaseId })).rejects.toThrow("already been used");
  });

  test("locks purchases that belong to a closed shift", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await ownerT.mutation(api.shifts.open, { openingCashKobo: 0 });
    const riceId = await seedIngredient(t, "Rice", 0, 1000, "kg");
    const { purchaseId } = await ownerT.mutation(api.money.receivePurchase, { paymentMethod: "cash", items: [{ ingredientId: riceId, quantity: 1, unitCostKobo: 1000 }] });
    const beforeClose = await ownerT.query(api.shifts.current, {});
    await ownerT.mutation(api.shifts.close, { shiftId: beforeClose!._id, countedCashKobo: 0, note: "Test close" });

    const detail = await ownerT.query(api.money.purchaseLines, { purchaseId });
    expect(detail.editable).toBe(false);
    await expect(ownerT.mutation(api.money.removePurchase, { purchaseId })).rejects.toThrow("closed shift");
    await expect(ownerT.mutation(api.money.addPurchaseItems, { purchaseId, items: [{ ingredientId: riceId, quantity: 1, unitCostKobo: 1000 }] })).rejects.toThrow("closed shift");
    await expect(ownerT.mutation(api.money.removePurchaseItem, { lineId: detail.lines[0]._id })).rejects.toThrow("closed shift");
    await expect(ownerT.mutation(api.money.updatePurchaseItem, { lineId: detail.lines[0]._id, quantity: 2, unitCostKobo: 1000 })).rejects.toThrow("closed shift");
  });

  test("removes one line, returns its stock, and lowers the purchase total", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const riceId = await seedIngredient(t, "Rice", 4, 4000, "kg");
    const oilId = await seedIngredient(t, "Oil", 0, 0, "litre");
    const { purchaseId, totalKobo } = await ownerT.mutation(api.money.receivePurchase, { paymentMethod: "cash", items: [{ ingredientId: riceId, quantity: 2, unitCostKobo: 5000 }, { ingredientId: oilId, quantity: 3, unitCostKobo: 2000 }] });
    expect(totalKobo).toBe(16000);
    const lines = await t.run(async (ctx) => ctx.db.query("purchaseItems").withIndex("by_purchaseId", (q) => q.eq("purchaseId", purchaseId)).collect());
    const riceLine = lines.find((line) => line.ingredientId === riceId)!;

    const result = await ownerT.mutation(api.money.removePurchaseItem, { lineId: riceLine._id });
    expect(result.totalKobo).toBe(6000);
    const rice = await t.run(async (ctx) => ctx.db.get(riceId));
    expect(rice?.quantity).toBe(4);
    expect(rice?.costPerUnitKobo).toBeCloseTo(4000, 6);
    const remaining = await t.run(async (ctx) => ctx.db.query("purchaseItems").withIndex("by_purchaseId", (q) => q.eq("purchaseId", purchaseId)).collect());
    expect(remaining).toHaveLength(1);
  });

  test("updates a line's quantity and cost and recomputes stock and average", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const riceId = await seedIngredient(t, "Rice", 4, 4000, "kg");
    const { purchaseId } = await ownerT.mutation(api.money.receivePurchase, { paymentMethod: "cash", items: [{ ingredientId: riceId, quantity: 2, unitCostKobo: 5000 }] });
    const lines = await t.run(async (ctx) => ctx.db.query("purchaseItems").withIndex("by_purchaseId", (q) => q.eq("purchaseId", purchaseId)).collect());

    const result = await ownerT.mutation(api.money.updatePurchaseItem, { lineId: lines[0]._id, quantity: 4, unitCostKobo: 3000 });
    expect(result.totalKobo).toBe(12000);
    const rice = await t.run(async (ctx) => ctx.db.get(riceId));
    expect(rice?.quantity).toBe(8);
    expect(rice?.costPerUnitKobo).toBeCloseTo((4 * 4000 + 4 * 3000) / 8, 6);
    const updated = await t.run(async (ctx) => ctx.db.get(lines[0]._id));
    expect(updated?.quantity).toBe(4);
    expect(updated?.unitCostKobo).toBe(3000);
    expect(updated?.totalKobo).toBe(12000);
  });
});