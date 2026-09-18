/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { asOwner, newT } from "./testHelp";

describe("menu bulk add", () => {
  test("creates multiple items in the same category at once", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await ownerT.mutation(api.menu.createCategory, { name: "Grills" });
    const { count } = await ownerT.mutation(api.menu.createItems, {
      category: "Grills",
      items: [
        { name: "Beef skewer", description: "Spiced beef", priceKobo: 80000 },
        { name: "Chicken wings", description: "", priceKobo: 100000 },
      ],
    });
    expect(count).toBe(2);
    const items = await ownerT.query(api.menu.manageItems, {});
    const grills = items.filter((item) => item.category === "Grills");
    expect(grills.length).toBe(2);
    expect(grills.map((item) => item.name).sort()).toEqual(["Beef skewer", "Chicken wings"]);
    expect(grills.map((item) => item.priceKobo).sort((a, b) => a - b)).toEqual([80000, 100000]);
    expect(grills.every((item) => item.active)).toBe(true);
  });

  test("assigns increasing sortOrder across a batch", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await ownerT.mutation(api.menu.createCategory, { name: "Grills" });
    await ownerT.mutation(api.menu.createCategory, { name: "Drinks" });
    await ownerT.mutation(api.menu.createItems, {
      category: "Drinks",
      items: [
        { name: "Chapman", description: "", priceKobo: 30000 },
        { name: "Zobo", description: "", priceKobo: 30000 },
      ],
    });
    const items = await ownerT.query(api.menu.manageItems, {});
    const drinks = items.filter((item) => item.category === "Drinks").sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    expect(drinks.map((item) => item.name)).toEqual(["Chapman", "Zobo"]);
  });

  test("rejects empty name, zero price, unknown category and empty batch", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await ownerT.mutation(api.menu.createCategory, { name: "Grills" });
    await expect(ownerT.mutation(api.menu.createItems, { category: "Grills", items: [{ name: "  ", description: "", priceKobo: 5000 }] })).rejects.toThrow("name is required");
    await expect(ownerT.mutation(api.menu.createItems, { category: "Grills", items: [{ name: "Okpa", description: "", priceKobo: 0 }] })).rejects.toThrow("price greater than zero");
    await expect(ownerT.mutation(api.menu.createItems, { category: "Nope", items: [{ name: "X", description: "", priceKobo: 5000 }] })).rejects.toThrow("Choose an active menu category");
    await expect(ownerT.mutation(api.menu.createItems, { category: "Grills", items: [] })).rejects.toThrow("at least one menu item");
  });
});