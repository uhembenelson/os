/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as ai from "../ai.js";
import type * as auth from "../auth.js";
import type * as authz from "../authz.js";
import type * as http from "../http.js";
import type * as inventory from "../inventory.js";
import type * as menu from "../menu.js";
import type * as money from "../money.js";
import type * as orders from "../orders.js";
import type * as recipes from "../recipes.js";
import type * as reports from "../reports.js";
import type * as shifts from "../shifts.js";
import type * as team from "../team.js";
import type * as testHelp from "../testHelp.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  ai: typeof ai;
  auth: typeof auth;
  authz: typeof authz;
  http: typeof http;
  inventory: typeof inventory;
  menu: typeof menu;
  money: typeof money;
  orders: typeof orders;
  recipes: typeof recipes;
  reports: typeof reports;
  shifts: typeof shifts;
  team: typeof team;
  testHelp: typeof testHelp;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
};
