import { test, expect, describe } from "vitest";
import { asOwner, createStaffAsOwner, newT, seedIngredient, seedRecipe } from "./testHelp";
import { api } from "./_generated/api";

describe("stockReport", () => {
  test("summarizes stock value, low and negative stock, waste value, and most-used ingredients", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const riceId = await seedIngredient(t, "Rice", 4, 4000, "kg");
    await seedIngredient(t, "Oil", -2, 1000, "litre");
    const saltId = await seedIngredient(t, "Salt", 1, 0, "kg");
    await ownerT.mutation(api.inventory.setLowStockLevel, { ingredientId: saltId, lowStockLevel: 5 });

    const itemId = await t.run(async (ctx) => ctx.db.insert("menuItems", { name: "Rice dish", priceKobo: 50000, category: "Mains", key: "rice", active: true, sortOrder: 0 }));
    await seedRecipe(t, itemId, riceId, 0.5);
    await ownerT.mutation(api.orders.create, {
      clientRequestId: `stock-${Math.random()}`,
      orderType: "takeaway",
      deliveryFeeKobo: 0,
      packagingFeeKobo: 0,
      items: [{ key: "rice", name: "Rice dish", quantity: 2, unitPriceKobo: 50000 }],
    });
    await ownerT.mutation(api.inventory.recordWaste, { ingredientId: riceId, quantity: 2 });

    const report = await ownerT.query(api.inventory.stockReport, { from: 0, to: Date.now() + 60000 });
    expect(report.stockValueKobo).toBe(4000);
    expect(report.lowStockCount).toBe(2);
    expect(report.negativeStockCount).toBe(1);
    expect(report.wasteValueKobo).toBe(8000);
    expect(report.mostUsed[0].name).toBe("Rice");
    expect(report.mostUsed[0].quantity).toBe(3);
  });

  test("refuses cashiers", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const cashierT = await createStaffAsOwner(ownerT, t, "Cash", "+2348099999999", "111111", "cashier");
    await expect(cashierT.query(api.inventory.stockReport, { from: 0, to: Date.now() })).rejects.toThrow("permission");
  });
});

describe("ingredient management", () => {
  test("creates an ingredient with opening stock and an opening movement", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const { ingredientId } = await ownerT.mutation(api.inventory.createIngredient, { name: "Pepper", unit: "kg", quantity: 5, lowStockLevel: 2, costPerUnitKobo: 3000 });
    const ingredient = await t.run(async (ctx) => ctx.db.get(ingredientId));
    expect(ingredient?.name).toBe("Pepper");
    expect(ingredient?.unit).toBe("kg");
    expect(ingredient?.quantity).toBe(5);
    expect(ingredient?.lowStockLevel).toBe(2);
    expect(ingredient?.costPerUnitKobo).toBe(3000);
    expect(ingredient?.active).toBe(true);
    const movements = await t.run(async (ctx) => ctx.db.query("inventoryMovements").withIndex("by_ingredientId_and_createdAt", (q) => q.eq("ingredientId", ingredientId)).collect());
    expect(movements).toHaveLength(1);
    expect(movements[0].quantityDelta).toBe(5);
    expect(movements[0].balanceAfter).toBe(5);
    expect(movements[0].note).toBe("Opening stock");
  });

  test("rejects duplicate names case-insensitively and empty fields", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await ownerT.mutation(api.inventory.createIngredient, { name: "Pepper", unit: "kg" });
    await expect(ownerT.mutation(api.inventory.createIngredient, { name: "pepper", unit: "kg" })).rejects.toThrow("already exists");
    await expect(ownerT.mutation(api.inventory.createIngredient, { name: "  ", unit: "kg" })).rejects.toThrow("name");
    await expect(ownerT.mutation(api.inventory.createIngredient, { name: "Salt", unit: "  " })).rejects.toThrow("unit");
  });

  test("updates fields, keeps its own name, and blocks renaming onto another ingredient", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const pepperId = await ownerT.mutation(api.inventory.createIngredient, { name: "Pepper", unit: "kg" });
    await ownerT.mutation(api.inventory.createIngredient, { name: "Salt", unit: "kg" });

    await ownerT.mutation(api.inventory.updateIngredient, { ingredientId: pepperId.ingredientId, name: "Pepper", unit: "gram", lowStockLevel: 4, costPerUnitKobo: 2500, active: false });
    const updated = await t.run(async (ctx) => ctx.db.get(pepperId.ingredientId));
    expect(updated?.unit).toBe("gram");
    expect(updated?.lowStockLevel).toBe(4);
    expect(updated?.costPerUnitKobo).toBe(2500);
    expect(updated?.active).toBe(false);

    await expect(ownerT.mutation(api.inventory.updateIngredient, { ingredientId: pepperId.ingredientId, name: "Salt", unit: "kg", lowStockLevel: 0, costPerUnitKobo: 0, active: true })).rejects.toThrow("already exists");
    await expect(ownerT.mutation(api.inventory.updateIngredient, { ingredientId: pepperId.ingredientId, name: "Pepper", unit: "kg", lowStockLevel: -1, costPerUnitKobo: 0, active: true })).rejects.toThrow("cannot be negative");
  });

  test("deletes an unused ingredient but refuses ones with recipes or stock history", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const plainId = await ownerT.mutation(api.inventory.createIngredient, { name: "Plain", unit: "kg" });
    await ownerT.mutation(api.inventory.deleteIngredient, { ingredientId: plainId.ingredientId });
    expect(await t.run(async (ctx) => ctx.db.get(plainId.ingredientId))).toBeNull();

    const itemId = await t.run(async (ctx) => ctx.db.insert("menuItems", { name: "Rice dish", priceKobo: 50000, category: "Mains", key: "rice", active: true, sortOrder: 0 }));
    const riceId = await seedIngredient(t, "Rice", 4, 4000, "kg");
    await seedRecipe(t, itemId, riceId, 0.5);
    await expect(ownerT.mutation(api.inventory.deleteIngredient, { ingredientId: riceId })).rejects.toThrow("recipes");

    const oilId = await seedIngredient(t, "Oil", 4, 4000, "litre");
    await ownerT.mutation(api.inventory.recordWaste, { ingredientId: oilId, quantity: 1 });
    await expect(ownerT.mutation(api.inventory.deleteIngredient, { ingredientId: oilId })).rejects.toThrow("stock history");
  });
});
