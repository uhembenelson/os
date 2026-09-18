import { action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { z } from "zod";
import { Agent, createTool, stepCountIs } from "@convex-dev/agent";
import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { components, api } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { StaffRole } from "./authz";

type StaffRoleFilter = "owner" | "manager";

async function requireRoleAction(ctx: ActionCtx, ...roles: StaffRoleFilter[]) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Sign in is required.");
  const staff = await ctx.runQuery(api.team.current, {});
  if (!staff || !(roles as StaffRole[]).includes(staff.role)) throw new Error("You do not have permission to use the assistant.");
}

function startEnd(days: number) {
  const end = Date.now();
  const start = end - Math.max(1, Math.round(days)) * 86_400_000;
  return { from: start, to: end };
}

type TodaySummaryToolOutput = {
  netSalesNaira: number;
  orderCount: number;
  cashNaira: number;
  cardNaira: number;
  transferNaira: number;
  foodCostNaira: number;
  expensesNaira: number;
  estimatedProfitNaira: number;
};

const todaySummary = createTool({
  description: "Today's totals: net sales, orders, cash/card/transfer collections, food cost, expenses, estimated profit.",
  inputSchema: z.object({}),
  execute: async (ctx): Promise<TodaySummaryToolOutput> => {
    const { from, to } = startEnd(1);
    const summary = await ctx.runQuery(api.money.summary, { from, to });
    return {
      netSalesNaira: Math.round(summary.netCollectedKobo / 100),
      orderCount: summary.orderCount,
      cashNaira: Math.round(summary.cashKobo / 100),
      cardNaira: Math.round(summary.cardKobo / 100),
      transferNaira: Math.round(summary.transferKobo / 100),
      foodCostNaira: Math.round(summary.foodCostKobo / 100),
      expensesNaira: Math.round(summary.expensesKobo / 100),
      estimatedProfitNaira: Math.round(summary.estimatedProfitKobo / 100),
    };
  },
});

type SalesReportToolOutput = {
  days: number;
  netSalesNaira: number;
  orders: number;
  averageOrderNaira: number;
  foodCostNaira: number;
  foodCostPct: number;
  expensesNaira: number;
  estimatedProfitNaira: number;
};

const salesReport = createTool({
  description: "Aggregated sales for a period. days defaults to 7 if omitted.",
  inputSchema: z.object({ days: z.number().min(1).max(90).optional().describe("Number of days to look back (1 = today, 7 = this week, 30 = this month)") }),
  execute: async (ctx, args): Promise<SalesReportToolOutput> => {
    const { from, to } = startEnd(args.days ?? 7);
    const report = await ctx.runQuery(api.reports.salesReport, { from, to });
    return { days: args.days ?? 7, netSalesNaira: Math.round(report.netSalesKobo / 100), orders: report.orderCount, averageOrderNaira: Math.round(report.averageOrderKobo / 100), foodCostNaira: Math.round(report.foodCostKobo / 100), foodCostPct: report.foodCostPct, expensesNaira: Math.round(report.expensesKobo / 100), estimatedProfitNaira: Math.round(report.estimatedProfitKobo / 100) };
  },
});

type TopSellersToolOutput = { name: string; quantity: number; revenueNaira: number }[];

const topSellers = createTool({
  description: "Best-selling menu items by quantity for a period. limit defaults to 5.",
  inputSchema: z.object({ days: z.number().min(1).max(90).optional().describe("Number of days to look back"), limit: z.number().min(1).max(20).optional().describe("Maximum items to return") }),
  execute: async (ctx, args): Promise<TopSellersToolOutput> => {
    const { from, to } = startEnd(args.days ?? 7);
    const items = await ctx.runQuery(api.reports.topItems, { from, to, limit: args.limit ?? 5 });
    return items.map((item) => ({ name: item.name, quantity: item.quantity, revenueNaira: Math.round(item.revenueKobo / 100) }));
  },
});

type ExpensesByTypeToolOutput = { type: string; totalNaira: number; count: number }[];

const expensesByType = createTool({
  description: "Expenses grouped by category for a period. days defaults to 30.",
  inputSchema: z.object({ days: z.number().min(1).max(90).optional().describe("Number of days to look back") }),
  execute: async (ctx, args): Promise<ExpensesByTypeToolOutput> => {
    const { from, to } = startEnd(args.days ?? 30);
    const rows = await ctx.runQuery(api.money.expensesByType, { from, to });
    return rows.map((row) => ({ type: row.type, totalNaira: Math.round(row.totalKobo / 100), count: row.count }));
  },
});

const listExpenseTypes = createTool({
  description: "List configured expense categories.",
  inputSchema: z.object({}),
  execute: async (ctx): Promise<string[]> => {
    const types = await ctx.runQuery(api.money.listExpenseTypes, {});
    return types.map((t) => t.name);
  },
});

type CurrentShiftToolOutput =
  | { open: false; message: string }
  | {
      open: true;
      openingCashNaira: number;
      expectedCashNaira: number;
      cashSalesNaira: number;
      cashRefundsNaira: number;
      cashExpensesNaira: number;
      cashPurchasesNaira: number;
    };

const currentShift = createTool({
  description: "The current open shift status: opening cash, expected cash, cash sales, cash refunds, cash expenses, cash purchases.",
  inputSchema: z.object({}),
  execute: async (ctx): Promise<CurrentShiftToolOutput> => {
    const shift = await ctx.runQuery(api.shifts.current, {});
    if (!shift) return { open: false, message: "No shift is open right now." };
    return {
      open: true,
      openingCashNaira: Math.round(shift.openingCashKobo / 100),
      expectedCashNaira: Math.round(shift.expectedCashKobo / 100),
      cashSalesNaira: Math.round(shift.cashPaidKobo / 100),
      cashRefundsNaira: Math.round(shift.cashRefundedKobo / 100),
      cashExpensesNaira: Math.round(shift.cashExpensesKobo / 100),
      cashPurchasesNaira: Math.round(shift.cashPurchasesKobo / 100),
    };
  },
});

type LowStockToolOutput = { name: string; quantity: number; unit: string; lowStockLevel: number }[];

const lowStock = createTool({
  description: "Ingredients at or below their low-stock level.",
  inputSchema: z.object({}),
  execute: async (ctx): Promise<LowStockToolOutput> => {
    const ingredients = await ctx.runQuery(api.inventory.listIngredients, {});
    return ingredients
      .filter((i) => i.quantity <= i.lowStockLevel)
      .map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit, lowStockLevel: i.lowStockLevel }));
  },
});

const nectarAssistant = new Agent(components.agent, {
  name: "Nectar Assistant",
  languageModel: convexGateway("openai/gpt-4o-mini"),
  instructions: [
    "You are Nectar Assistant, the operations assistant for a restaurant using the Nectar POS.",
    "You can only see data the tools return. Always answer concisely in a helpful, professional tone.",
    "Amounts returned by tools are in whole naira ₦. Format them nicely.",
    "When a user asks about today use days=1, this week use days=7, this month use days=30, and for vague recency use days=30 unless they say otherwise.",
    "You cannot place orders or change data. You only report on business metrics.",
  ].join("\n"),
  tools: { todaySummary, salesReport, topSellers, expensesByType, listExpenseTypes, currentShift, lowStock },
  stopWhen: stepCountIs(4),
});

type ChatResult = { threadId: string; text: string };

export const chat = action({
  args: { prompt: v.string(), threadId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<ChatResult> => {
    await requireRoleAction(ctx, "owner");
    const prompt = args.prompt.trim();
    if (!prompt) throw new Error("Ask me something first.");
    const userId = await getAuthUserId(ctx);
    if (args.threadId) {
      const { thread } = await nectarAssistant.continueThread(ctx, { threadId: args.threadId, userId });
      const result = await thread.generateText({ prompt });
      return { threadId: args.threadId, text: result.text };
    }
    const { threadId, thread } = await nectarAssistant.createThread(ctx, { userId });
    const result = await thread.generateText({ prompt });
    return { threadId, text: result.text };
  },
});