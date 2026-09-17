import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { convexAuth } from "@convex-dev/auth/server";
import { Scrypt } from "lucia";
import { makeFunctionReference } from "convex/server";

const pinLookup = makeFunctionReference<"query">("team:lookupPin");
const consumeAttempt = makeFunctionReference<"mutation", { phone: string }, boolean>("team:checkPinAttempt");

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    ConvexCredentials({
      id: "phone-pin",
      authorize: async (credentials, ctx) => {
        const phone = typeof credentials.phone === "string" ? credentials.phone : "";
        const pin = typeof credentials.pin === "string" ? credentials.pin : "";
        if (!/^\+\d{8,15}$/.test(phone) || !/^\d{6}$/.test(pin)) return null;
        if (!(await ctx.runMutation(consumeAttempt, { phone }))) return null;
        const account = await ctx.runQuery(pinLookup, { phone });
        if (!account || !account.active) return null;
        const valid = await new Scrypt().verify(account.pinHash, pin).catch(() => false);
        return valid ? { userId: account.userId } : null;
      },
    }),
  ],
  signIn: { maxFailedAttempsPerHour: 5 },
});
