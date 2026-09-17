import { v } from "convex/values";
import { Scrypt } from "lucia";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireRole } from "./authz";

function normalizePhone(value: string) {
  const compact = value.replace(/[\s()-]/g, "");
  const canonical = compact.startsWith("00") ? `+${compact.slice(2)}` : compact.startsWith("0") ? `+234${compact.slice(1)}` : compact.startsWith("+") ? compact : `+${compact}`;
  if (!/^\+\d{8,15}$/.test(canonical)) throw new Error("Enter a valid phone number with country code.");
  return canonical;
}

async function requireOwner(ctx: MutationCtx | QueryCtx) {
  return requireRole(ctx, "owner");
}

const hashed = async (pin: string) => new Scrypt().hash(pin);

async function clearPinAttempts(ctx: MutationCtx, phone: string) {
  const state = await ctx.db.query("pinAttempts").withIndex("by_phone", (q) => q.eq("phone", phone)).unique();
  if (state) await ctx.db.delete(state._id);
}

export const setupStatus = query({
  args: {},
  handler: async (ctx) => ({
    ownerExists: (await ctx.db.query("users").withIndex("phone").collect()).some((user) => user.role === "owner"),
  }),
});

export const bootstrapOwner = mutation({
  args: { name: v.string(), phone: v.string(), pin: v.string(), recoveryPin: v.string() },
  handler: async (ctx, args) => {
    if ((await ctx.db.query("users").collect()).length !== 0) throw new Error("Owner setup has already been completed.");
    const name = args.name.trim();
    const phone = normalizePhone(args.phone);
    if (!name) throw new Error("Enter the owner's name.");
    if (!/^\d{6}$/.test(args.pin)) throw new Error("PIN must be exactly six digits.");
    if (!/^\d{6}$/.test(args.recoveryPin)) throw new Error("Recovery PIN must be exactly six digits.");
    const userId = await ctx.db.insert("users", { name, phone, role: "owner", active: true });
    await ctx.db.insert("staffPins", { userId, phone, pinHash: await hashed(args.pin), recoveryPinHash: await hashed(args.recoveryPin), active: true });
    return { userId };
  },
});

export const createStaff = mutation({
  args: { name: v.string(), phone: v.string(), pin: v.string(), role: v.union(v.literal("manager"), v.literal("cashier"), v.literal("kitchen")) },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const name = args.name.trim();
    const phone = normalizePhone(args.phone);
    if (!name) throw new Error("Enter the staff member's name.");
    if (!/^\d{6}$/.test(args.pin)) throw new Error("PIN must be exactly six digits.");
    const existing = await ctx.db.query("staffPins").withIndex("by_phone", (q) => q.eq("phone", phone)).unique();
    if (existing) throw new Error("An account already uses this phone number.");
    const userId = await ctx.db.insert("users", { name, phone, role: args.role, active: true });
    await ctx.db.insert("staffPins", { userId, phone, pinHash: await hashed(args.pin), active: true });
  },
});

export const resetStaffPin = mutation({
  args: { userId: v.id("users"), newPin: v.string() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    if (!/^\d{6}$/.test(args.newPin)) throw new Error("PIN must be exactly six digits.");
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("Staff account not found.");
    const pinRecord = await ctx.db.query("staffPins").withIndex("by_userId", (q) => q.eq("userId", args.userId)).unique();
    if (!pinRecord) throw new Error("This account has no PIN record.");
    await ctx.db.patch(pinRecord._id, { pinHash: await hashed(args.newPin), active: true });
    await ctx.db.patch(args.userId, { active: true });
    await clearPinAttempts(ctx, pinRecord.phone);
    return { phone: pinRecord.phone };
  },
});

export const changePin = mutation({
  args: { currentPin: v.string(), newPin: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in is required.");
    if (!/^\d{6}$/.test(args.newPin)) throw new Error("New PIN must be exactly six digits.");
    if (args.currentPin === args.newPin) throw new Error("New PIN must be different from the current PIN.");
    const user = await ctx.db.get(userId);
    if (!user || user.active === false) throw new Error("This staff account is inactive or unavailable.");
    const pinRecord = await ctx.db.query("staffPins").withIndex("by_userId", (q) => q.eq("userId", userId)).unique();
    if (!pinRecord) throw new Error("No PIN record was found for this account.");
    const valid = await new Scrypt().verify(pinRecord.pinHash, args.currentPin).catch(() => false);
    if (!valid) throw new Error("Current PIN is incorrect.");
    await ctx.db.patch(pinRecord._id, { pinHash: await hashed(args.newPin) });
    await clearPinAttempts(ctx, pinRecord.phone);
    return null;
  },
});

export const recoverOwnerPin = mutation({
  args: { phone: v.string(), recoveryPin: v.string(), newPin: v.string() },
  handler: async (ctx, args) => {
    if (!/^\d{6}$/.test(args.recoveryPin)) throw new Error("Recovery PIN must be exactly six digits.");
    if (!/^\d{6}$/.test(args.newPin)) throw new Error("New PIN must be exactly six digits.");
    const phone = normalizePhone(args.phone);
    const pinRecord = await ctx.db.query("staffPins").withIndex("by_phone", (q) => q.eq("phone", phone)).unique();
    if (!pinRecord || !pinRecord.recoveryPinHash) throw new Error("No owner recovery record was found for this phone.");
    const user = await ctx.db.get(pinRecord.userId);
    if (!user || user.role !== "owner") throw new Error("Recovery is only available for the owner account.");
    const valid = await new Scrypt().verify(pinRecord.recoveryPinHash, args.recoveryPin).catch(() => false);
    if (!valid) throw new Error("Recovery PIN is incorrect.");
    await ctx.db.patch(pinRecord._id, { pinHash: await hashed(args.newPin) });
    await clearPinAttempts(ctx, phone);
    return null;
  },
});

export const listStaff = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const users = await ctx.db.query("users").collect();
    return users.filter((user) => user.role).map(({ _id, name, phone, role, active }) => ({ _id, name, phone, role, active }));
  },
});

export const setStaffActive = mutation({
  args: { userId: v.id("users"), active: v.boolean() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const user = await ctx.db.get(args.userId);
    if (!user || user.role === "owner") throw new Error("Staff account not found.");
    await ctx.db.patch(args.userId, { active: args.active });
    const pinRecord = await ctx.db.query("staffPins").withIndex("by_userId", (q) => q.eq("userId", args.userId)).unique();
    if (pinRecord) {
      await ctx.db.patch(pinRecord._id, { active: args.active });
      if (args.active) await clearPinAttempts(ctx, pinRecord.phone);
    }
  },
});

export const current = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user || user.active === false) return null;
    return { name: user.name ?? "Staff", phone: user.phone ?? "", role: user.role ?? "cashier" };
  },
});

export const lookupPin = internalQuery({
  args: { phone: v.string() },
  handler: async (ctx, { phone }) => {
    const account = await ctx.db.query("staffPins").withIndex("by_phone", (q) => q.eq("phone", phone)).unique();
    if (!account) return null;
    const user = await ctx.db.get(account.userId);
    if (!user || user.active === false) return { ...account, active: false };
    return account;
  },
});

export const checkPinAttempt = internalMutation({
  args: { phone: v.string() },
  handler: async (ctx, { phone }) => {
    const now = Date.now();
    const state = await ctx.db.query("pinAttempts").withIndex("by_phone", (q) => q.eq("phone", phone)).unique();
    if (state && now - state.windowStartedAt < 60 * 60 * 1000 && state.attempts >= 5) return false;
    if (!state || now - state.windowStartedAt >= 60 * 60 * 1000) {
      if (state) await ctx.db.patch(state._id, { attempts: 1, windowStartedAt: now });
      else await ctx.db.insert("pinAttempts", { phone, attempts: 1, windowStartedAt: now });
    } else {
      await ctx.db.patch(state._id, { attempts: state.attempts + 1 });
    }
    return true;
  },
});
