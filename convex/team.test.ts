import { test, expect, describe } from "vitest";
import { asOwner, createStaffAsOwner, newT } from "./testHelp";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

describe("owner setup", () => {
  test("first-run setup creates the owner account and returns the user id", async () => {
    const t = newT();
    const { userId } = await t.mutation(api.team.bootstrapOwner, {
      name: "Ada",
      phone: "08012345678",
      pin: "123456",
      recoveryPin: "654321",
    });
    expect(userId).toMatch(/users$/);
    const status = await t.query(api.team.setupStatus, {});
    expect(status.ownerExists).toBe(true);
    const pinRecord = await t.run(async (ctx) => {
      return ctx.db.query("staffPins").withIndex("by_phone", (q) => q.eq("phone", "+2348012345678")).unique();
    });
    expect(pinRecord?.recoveryPinHash).toBeDefined();
  });

  test("second setup attempt is blocked", async () => {
    const t = newT();
    await t.mutation(api.team.bootstrapOwner, { name: "Ada", phone: "+2348012345678", pin: "123456", recoveryPin: "654321" });
    await expect(t.mutation(api.team.bootstrapOwner, { name: "Bisi", phone: "+2348098765432", pin: "111111", recoveryPin: "222222" })).rejects.toThrow("already been completed");
  });

  test("rejects invalid PIN formats", async () => {
    const t = newT();
    await expect(t.mutation(api.team.bootstrapOwner, { name: "Ada", phone: "+2348012345678", pin: "12345", recoveryPin: "654321" })).rejects.toThrow("exactly six digits");
    await expect(t.mutation(api.team.bootstrapOwner, { name: "Ada", phone: "+2348012345678", pin: "123456", recoveryPin: "abc" })).rejects.toThrow("exactly six digits");
  });
});

describe("recovery", () => {
  test("recoverOwnerPin resets the PIN and guards against wrong recovery PIN and unknown phones", async () => {
    const t = newT();
    await t.mutation(api.team.bootstrapOwner, { name: "Ada", phone: "+2348012345678", pin: "123456", recoveryPin: "654321" });
    await expect(t.mutation(api.team.recoverOwnerPin, { phone: "08099999999", recoveryPin: "654321", newPin: "333333" })).rejects.toThrow("No owner recovery record");
    await expect(t.mutation(api.team.recoverOwnerPin, { phone: "+2348012345678", recoveryPin: "000000", newPin: "333333" })).rejects.toThrow("Recovery PIN is incorrect");
    await expect(t.mutation(api.team.recoverOwnerPin, { phone: "+2348012345678", recoveryPin: "654321", newPin: "333333" })).resolves.toBeNull();
    const pinRecord = await t.run(async (ctx) => ctx.db.query("staffPins").withIndex("by_phone", (q) => q.eq("phone", "+2348012345678")).unique());
    expect(pinRecord?.pinHash).toBeDefined();
  });

  test("recovery is owner-only", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const cashierT = await createStaffAsOwner(ownerT, t, "Bola", "08098765432", "222222", "cashier");
    await expect(cashierT.mutation(api.team.recoverOwnerPin, { phone: "+2348098765432", recoveryPin: "654321", newPin: "333333" })).rejects.toThrow("No owner recovery record");
  });
});

describe("PIN management", () => {
  test("changePin verifies the current PIN and updates the hash", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    await expect(ownerT.mutation(api.team.changePin, { currentPin: "000000", newPin: "222222" })).rejects.toThrow("Current PIN is incorrect");
    await expect(ownerT.mutation(api.team.changePin, { currentPin: "123456", newPin: "123456" })).rejects.toThrow("different");
    await expect(ownerT.mutation(api.team.changePin, { currentPin: "123456", newPin: "222222" })).resolves.toBeNull();
  });

  test("resetStaffPin is owner-only and updates the staff PIN", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const cashierT = await createStaffAsOwner(ownerT, t, "Bola", "08098765432", "222222", "cashier");
    const { phone } = await ownerT.mutation(api.team.resetStaffPin, { userId: (await ownerT.query(api.team.listStaff, {})).find((row) => row.role === "cashier")!._id, newPin: "555555" });
    expect(phone).toBe("+2348098765432");
    await expect(cashierT.mutation(api.team.createStaff, { name: "Chi", phone: "+2348011111111", pin: "111111", role: "cashier" })).rejects.toThrow("do not have permission");
    await expect(t.mutation(api.team.resetStaffPin, { userId: "000000000000000000000010000users" as Id<"users">, newPin: "555555" })).rejects.toThrow("Sign in is required");
  });
});

describe("access control", () => {
  test("deactivated staff are blocked from staff APIs", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const cashierT = await createStaffAsOwner(ownerT, t, "Bola", "08098765432", "222222", "cashier");
    const staff = (await ownerT.query(api.team.listStaff, {})).find((row) => row.role === "cashier")!;
    await ownerT.mutation(api.team.setStaffActive, { userId: staff._id, active: false });
    await expect(cashierT.query(api.menu.list, {})).rejects.toThrow("inactive or unavailable");
    await expect(cashierT.mutation(api.orders.create, {
      clientRequestId: "c-1",
      orderType: "takeaway",
      deliveryFeeKobo: 0,
      packagingFeeKobo: 0,
      items: [],
    })).rejects.toThrow("inactive or unavailable");
  });

  test("kitchen staff cannot run cashier actions", async () => {
    const t = newT();
    const ownerT = await asOwner(t);
    const kitchenT = await createStaffAsOwner(ownerT, t, "Kofi", "08095555555", "333333", "kitchen");
    await expect(kitchenT.mutation(api.orders.create, { clientRequestId: "c-2", orderType: "takeaway", deliveryFeeKobo: 0, packagingFeeKobo: 0, items: [] })).rejects.toThrow("do not have permission");
    await expect(kitchenT.query(api.money.summary, { from: 0, to: Date.now() })).rejects.toThrow("do not have permission");
  });

  test("unauthenticated calls are rejected", async () => {
    const t = newT();
    await expect(t.query(api.money.summary, { from: 0, to: Date.now() })).rejects.toThrow("Sign in is required");
    await expect(t.query(api.team.listStaff, {})).rejects.toThrow("Sign in is required");
  });
});