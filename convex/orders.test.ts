import { test, expect, describe } from "vitest";
import { asOwner, newT, seedIngredient, seedRecipe, type Ctx, type Owned } from "./testHelp";
import { api } from "./_generated/api";

async function seedOrderFixture(t: Ctx) {
  const itemId = await t.run(async (ctx) => ctx.db.insert("menuItems", { name: "Jollof", priceKobo: 450000, category: "Mains", key: "jollof", active: true, sortOrder: 0 }));
  const riceId = await seedIngredient(t, "Rice", 10, 1000, "kg");
  const oilId = await seedIngredient(t, "Oil", 5, 500, "litre");
  await seedRecipe(t, itemId, riceId, 0.3);
  await seedRecipe(t, itemId, oilId, 0.04);
  return { itemId, riceId, oilId };
}

describe("orders.create", () => {
  test("computes the total from items plus delivery and packaging", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { itemId } = await seedOrderFixture(t);
    const result = await ownerT.mutation(api.orders.create, {
      clientRequestId: "c-1",
      orderType: "dine-in",
      deliveryFeeKobo: 5000,
      packagingFeeKobo: 3000,
      items: [{ key: "jollof", name: "Jollof", quantity: 2, unitPriceKobo: 450000 }],
    });
    expect(result.totalKobo).toBe(2 * 450000 + 5000 + 3000);
  });

  test("is idempotent for the same clientRequestId and deducts stock once", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { riceId } = await seedOrderFixture(t);
    const args = {
      clientRequestId: "c-idem",
      orderType: "takeaway" as const,
      deliveryFeeKobo: 0,
      packagingFeeKobo: 0,
      items: [{ key: "jollof", name: "Jollof", quantity: 2, unitPriceKobo: 450000 }],
    };
    const first = await ownerT.mutation(api.orders.create, args);
    const second = await ownerT.mutation(api.orders.create, args);
    expect(second.orderId).toBe(first.orderId);
    const balance = await t.run(async (ctx) => (await ctx.db.get(riceId))!.quantity);
    expect(balance).toBeCloseTo(10 - 2 * 0.3);
    const sales = await t.run(async (ctx) => ctx.db.query("inventoryMovements").withIndex("by_ingredientId_and_createdAt", (q) => q.eq("ingredientId", riceId)).collect());
    expect(sales.filter((movement) => movement.type === "sale")).toHaveLength(1);
  });

  test("snapshots food cost from the recipe", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { riceId, oilId } = await seedOrderFixture(t);
    const { orderId } = await ownerT.mutation(api.orders.create, {
      clientRequestId: "c-2",
      orderType: "dine-in",
      deliveryFeeKobo: 0,
      packagingFeeKobo: 0,
      items: [{ key: "jollof", name: "Jollof", quantity: 2, unitPriceKobo: 450000 }],
    });
    const order = await t.run(async (ctx) => ctx.db.get(orderId));
    const expected = 2 * (0.3 * (await t.run(async (ctx) => (await ctx.db.get(riceId))!.costPerUnitKobo!)) + 0.04 * (await t.run(async (ctx) => (await ctx.db.get(oilId))!.costPerUnitKobo!)));
    expect(order?.foodCostKobo).toBeCloseTo(expected);
  });
});

describe("payments", () => {
  test("cash payment records tendered amount and change", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { orderId } = await seedAndCreateOrder(ownerT, t);
    const result = await ownerT.mutation(api.orders.markPaid, { orderId, paymentMethod: "cash", amountTenderedKobo: 500000 });
    expect(result.remainingKobo).toBe(0);
    expect(result.changeKobo).toBe(500000 - 450000);
    const order = await ownerT.query(api.orders.paymentSummary, { orderId });
    expect(order?.paidKobo).toBe(450000);
    expect(order?.order.paymentStatus).toBe("paid");
  });

  test("card payments must match the applied amount exactly", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { orderId } = await seedAndCreateOrder(ownerT, t);
    await expect(ownerT.mutation(api.orders.addPayment, { orderId, paymentMethod: "card", amountKobo: 400000, amountTenderedKobo: 399000 })).rejects.toThrow("must match");
    const result = await ownerT.mutation(api.orders.addPayment, { orderId, paymentMethod: "card", amountKobo: 400000, amountTenderedKobo: 400000 });
    expect(result.remainingKobo).toBe(50000);
  });

  test("supports split payments and rejects overpayment", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { orderId } = await seedAndCreateOrder(ownerT, t);
    await ownerT.mutation(api.orders.addPayment, { orderId, paymentMethod: "cash", amountKobo: 200000, amountTenderedKobo: 200000 });
    const second = await ownerT.mutation(api.orders.addPayment, { orderId, paymentMethod: "transfer", amountKobo: 250000, amountTenderedKobo: 250000 });
    expect(second.remainingKobo).toBe(0);
    await expect(ownerT.mutation(api.orders.addPayment, { orderId, paymentMethod: "cash", amountKobo: 1000, amountTenderedKobo: 1000 })).rejects.toThrow("cannot accept another payment");
  });

  test("rejects an applied amount larger than the remaining balance", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { orderId } = await seedAndCreateOrder(ownerT, t);
    await expect(ownerT.mutation(api.orders.addPayment, { orderId, paymentMethod: "cash", amountKobo: 500000, amountTenderedKobo: 500000 })).rejects.toThrow("remaining balance");
  });
});

describe("refunds", () => {
  test("refunds a paid order up to the refundable amount", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { orderId } = await seedAndCreateOrder(ownerT, t);
    await ownerT.mutation(api.orders.markPaid, { orderId, paymentMethod: "cash", amountTenderedKobo: 450000 });
    await expect(ownerT.mutation(api.orders.refund, { orderId, amountKobo: 500000, method: "cash" })).rejects.toThrow("Refund cannot exceed");
    const summary = await ownerT.mutation(api.orders.refund, { orderId, amountKobo: 450000, method: "cash", reason: "Overcharged" });
    expect(summary.remainingRefundableKobo).toBe(0);
    const order = await ownerT.query(api.orders.paymentSummary, { orderId });
    expect(order?.order.paymentStatus).toBe("refunded");
  });

  test("unpaid orders cannot be refunded", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { orderId } = await seedAndCreateOrder(ownerT, t);
    await expect(ownerT.mutation(api.orders.refund, { orderId, amountKobo: 1000, method: "cash" })).rejects.toThrow("Only paid orders");
  });
});

describe("kitchen", () => {
  test("follows the status state machine", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { orderId } = await seedAndCreateOrder(ownerT, t);
    await expect(ownerT.mutation(api.orders.updateKitchenStatus, { orderId, nextStatus: "ready" })).rejects.toThrow("cannot move");
    await ownerT.mutation(api.orders.updateKitchenStatus, { orderId, nextStatus: "preparing" });
    await ownerT.mutation(api.orders.updateKitchenStatus, { orderId, nextStatus: "ready" });
    await ownerT.mutation(api.orders.updateKitchenStatus, { orderId, nextStatus: "completed" });
    await expect(ownerT.mutation(api.orders.updateKitchenStatus, { orderId, nextStatus: "preparing" })).rejects.toThrow("cannot move");
  });

  test("a cancelled order cannot progress", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { orderId } = await seedAndCreateOrder(ownerT, t);
    await ownerT.mutation(api.orders.cancel, { orderId, inventoryHandling: "return" });
    await expect(ownerT.mutation(api.orders.updateKitchenStatus, { orderId, nextStatus: "preparing" })).rejects.toThrow("cannot move");
  });
});

describe("cancellation", () => {
  test("returns ingredients to stock on return", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { orderId, riceId } = await seedAndCreateOrder(ownerT, t);
    await ownerT.mutation(api.orders.cancel, { orderId, inventoryHandling: "return" });
    const balance = await t.run(async (ctx) => (await ctx.db.get(riceId))!.quantity);
    expect(balance).toBeCloseTo(10 - 0.3 + 0.3);
    const order = await t.run(async (ctx) => ctx.db.get(orderId));
    expect(order?.status).toBe("cancelled");
  });

  test("writes off ingredients on waste", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { orderId, riceId } = await seedAndCreateOrder(ownerT, t);
    await ownerT.mutation(api.orders.cancel, { orderId, inventoryHandling: "waste" });
    const balance = await t.run(async (ctx) => (await ctx.db.get(riceId))!.quantity);
    expect(balance).toBeCloseTo(10 - 0.3);
  });

  test("paid orders must be refunded before cancellation", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { orderId } = await seedAndCreateOrder(ownerT, t);
    await ownerT.mutation(api.orders.markPaid, { orderId, paymentMethod: "cash", amountTenderedKobo: 450000 });
    await expect(ownerT.mutation(api.orders.cancel, { orderId, inventoryHandling: "return" })).rejects.toThrow("refunded before cancellation");
  });

  test("completed orders cannot be cancelled", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { orderId } = await seedAndCreateOrder(ownerT, t);
    await ownerT.mutation(api.orders.updateKitchenStatus, { orderId, nextStatus: "preparing" });
    await ownerT.mutation(api.orders.updateKitchenStatus, { orderId, nextStatus: "ready" });
    await ownerT.mutation(api.orders.updateKitchenStatus, { orderId, nextStatus: "completed" });
    await expect(ownerT.mutation(api.orders.cancel, { orderId, inventoryHandling: "return" })).rejects.toThrow("can no longer be cancelled");
  });

  test("rejects items marked sold out and does not deduct stock", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { itemId, riceId } = await seedOrderFixture(t);
    await ownerT.mutation(api.menu.setSoldOut, { menuItemId: itemId, soldOut: true });
    await expect(ownerT.mutation(api.orders.create, {
      clientRequestId: "c-soldout",
      orderType: "takeaway",
      deliveryFeeKobo: 0,
      packagingFeeKobo: 0,
      items: [{ key: "jollof", name: "Jollof", quantity: 1, unitPriceKobo: 450000 }],
    })).rejects.toThrow("sold out");
    const balance = await t.run(async (ctx) => (await ctx.db.get(riceId))!.quantity);
    expect(balance).toBe(10);
  });

  test("rejects, allows re-enabling, and rejects inactive items", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { itemId, riceId } = await seedOrderFixture(t);
    await ownerT.mutation(api.menu.setSoldOut, { menuItemId: itemId, soldOut: true });
    await ownerT.mutation(api.menu.setSoldOut, { menuItemId: itemId, soldOut: false });
    await t.run(async (ctx) => ctx.db.patch(itemId, { active: false }));
    await expect(ownerT.mutation(api.orders.create, {
      clientRequestId: "c-inactive",
      orderType: "takeaway",
      deliveryFeeKobo: 0,
      packagingFeeKobo: 0,
      items: [{ key: "jollof", name: "Jollof", quantity: 1, unitPriceKobo: 450000 }],
    })).rejects.toThrow("no longer available");
    const balance = await t.run(async (ctx) => (await ctx.db.get(riceId))!.quantity);
    expect(balance).toBe(10);
  });
});

async function seedAndCreateOrder(ownerT: Owned, t: Ctx) {
  const { riceId } = await seedOrderFixture(t);
  const order = await ownerT.mutation(api.orders.create, {
    clientRequestId: `c-${Math.random()}`,
    orderType: "takeaway",
    deliveryFeeKobo: 0,
    packagingFeeKobo: 0,
    items: [{ key: "jollof", name: "Jollof", quantity: 1, unitPriceKobo: 450000 }],
  });
  return { ...order, riceId };
}