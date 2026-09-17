/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { api } from "./_generated/api";

export type Ctx = ReturnType<typeof newT>;
export type Owned = ReturnType<Ctx["withIdentity"]>;

export function newT() {
  return convexTest(schema, import.meta.glob("./**/*.ts"));
}

export async function asOwner(t: Ctx): Promise<Owned> {
  const { userId } = await t.mutation(api.team.bootstrapOwner, {
    name: "Ada Owner",
    phone: "+2348012345678",
    pin: "123456",
    recoveryPin: "654321",
  });
  return t.withIdentity({ subject: userId });
}

export async function createStaffAsOwner(
  ownerT: Owned,
  original: Ctx,
  name: string,
  phone: string,
  pin: string,
  role: "manager" | "cashier" | "kitchen"
): Promise<Owned> {
  await ownerT.mutation(api.team.createStaff, { name, phone, pin, role });
  const rows = await ownerT.query(api.team.listStaff, {});
  const compact = phone.replace(/[\s()-]/g, "");
  const canonical = compact.startsWith("00") ? `+${compact.slice(2)}` : compact.startsWith("0") ? `+234${compact.slice(1)}` : compact.startsWith("+") ? compact : `+${compact}`;
  const staff = rows.find((row) => row.phone === canonical);
  if (!staff) throw new Error("Created staff member not found");
  return original.withIdentity({ subject: staff._id });
}

export async function openShift(t: Ctx, openingCashKobo = 0) {
  const { shiftId } = await t.mutation(api.shifts.open, { openingCashKobo });
  return shiftId;
}

export async function seedMenuItem(t: Ctx, name: string, priceKobo: number, key: string) {
  await t.mutation(api.menu.createCategory, { name: "Mains" });
  return t.mutation(api.menu.createItem, { name, description: "test", category: "Mains", priceKobo });
}

export async function seedIngredient(
  t: Ctx,
  name: string,
  quantity: number,
  costPerUnitKobo: number,
  unit = "kg"
) {
  return t.run(async (ctx) => {
    return ctx.db.insert("ingredients", {
      name,
      unit,
      quantity,
      lowStockLevel: 0,
      costPerUnitKobo,
      active: true,
    });
  });
}

export async function seedRecipe(t: Ctx, menuItemId: Id<"menuItems">, ingredientId: Id<"ingredients">, quantity: number) {
  return t.run(async (ctx) => {
    return ctx.db.insert("recipes", { menuItemId, ingredientId, quantity });
  });
}