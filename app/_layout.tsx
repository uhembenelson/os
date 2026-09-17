import { Stack } from "expo-router";
import type { ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import Constants from "expo-constants";

function getConvexUrl() {
  const configuredUrl = process.env.EXPO_PUBLIC_CONVEX_URL ?? "https://placeholder.convex.cloud";
  const isLocalUrl = configuredUrl.includes("127.0.0.1") || configuredUrl.includes("localhost");

  if (!isLocalUrl) return configuredUrl;

  const expoHost = Constants.expoConfig?.hostUri?.split(":")[0]
    ?? Constants.linkingUri?.replace(/^.*?:\/\//, "").split(":")[0];

  if (!expoHost || expoHost === "127.0.0.1" || expoHost === "localhost") {
    return configuredUrl;
  }

  return configuredUrl.replace("127.0.0.1", expoHost).replace("localhost", expoHost);
}

const convex = new ConvexReactClient(getConvexUrl());
const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

function AppAuthProvider({ children }: { children: ReactNode }) {
  return <ConvexAuthProvider client={convex} storage={Platform.OS === "web" ? undefined : secureStorage}>{children}</ConvexAuthProvider>;
}

export default function RootLayout() {
  return (
      <AppAuthProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </AppAuthProvider>
  );
}
