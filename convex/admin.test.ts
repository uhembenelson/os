import { test, expect, describe } from "vitest";
import { asOwner, createStaffAsOwner, newT } from "./testHelp";
import { api } from "./_generated/api";

async function seedBusinessData(t: ReturnType<typeof newT>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("menuCategories", { name: "Mains", slug: "mains", sortOrder: 0, active: true });
    await ctx.db.insert("menuItems", { name: "Rice dish", priceKobo: 50000, category: "Mains", active: true, key: "rice" });
    await ctx.db.insert("ingredients", { name: "Rice", unit: "kg", quantity: 4, lowStockLevel: 1, costPerUnitKobo: 4000, active: true });
    await ctx.db.insert("shifts", { status: "closed", openingCashKobo: 0, expectedCashKobo: 0, openedAt: 1, closedAt: 2 });
    await ctx.db.insert("orders", { number: "0001", status: "completed", orderType: "takeaway", items: [], deliveryFeeKobo: 0, packagingFeeKobo: 0, totalKobo: 0, createdAt: 1 });
    await ctx.db.insert("expenses", { description: "Gas", amountKobo: 5000, createdAt: 1 });
    await ctx.db.insert("purchases", { totalKobo: 1000, createdAt: 1 });
  });
}

async function tableCounts(t: ReturnType<typeof newT>) {
  return t.run(async (ctx) => ({
    users: (await ctx.db.query("users").collect()).length,
    staffPins: (await ctx.db.query("staffPins").collect()).length,
    menuItems: (await ctx.db.query("menuItems").collect()).length,
    menuCategories: (await ctx.db.query("menuCategories").collect()).length,
    ingredients: (await ctx.db.query("ingredients").collect()).length,
    orders: (await ctx.db.query("orders").collect()).length,
    shifts: (await ctx.db.query("shifts").collect()).length,
    expenses: (await ctx.db.query("expenses").collect()).length,
    purchases: (await ctx.db.query("purchases").collect()).length,
  }));
}

describe("resetAllData", () => {
  test("clears business data, keeps the owner, and removes other staff", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await createStaffAsOwner(ownerT, t, "Manny", "+2348099999999", "111111", "manager");
    await seedBusinessData(t);

    const result = await ownerT.mutation(api.admin.resetAllData, { confirm: "RESET" });
    expect(result.removedStaff).toBe(1);

    const counts = await tableCounts(t);
    expect(counts.users).toBe(1);
    expect(counts.staffPins).toBe(1);
    expect(counts.orders).toBe(0);
    expect(counts.shifts).toBe(0);
    expect(counts.expenses).toBe(0);
    expect(counts.purchases).toBe(0);
    expect(counts.menuItems).toBe(0);
    expect(counts.menuCategories).toBe(0);
    expect(counts.ingredients).toBe(0);

    const menu = await ownerT.query(api.menu.list, {});
    expect(menu.length).toBe(0);
  });

  test("requires the confirmation word", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await seedBusinessData(t);

    await expect(ownerT.mutation(api.admin.resetAllData, { confirm: "please" })).rejects.toThrow("Type RESET");
    expect((await tableCounts(t)).orders).toBe(1);
  });

  test("refuses non-owners", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const managerT = await createStaffAsOwner(ownerT, t, "Manny", "+2348099999999", "111111", "manager");
    await expect(managerT.mutation(api.admin.resetAllData, { confirm: "RESET" })).rejects.toThrow("permission");
  });
});
