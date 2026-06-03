import path from "node:path";
import { defineConfig } from "vitest/config";

const pkg = (name: string) => path.resolve(__dirname, "packages", name, "dist/index.js");

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@m3/config": pkg("config"),
      "@m3/channels": pkg("channels"),
      "@m3/channel-extensions": pkg("channel-extensions"),
      "@m3/agent": pkg("agent"),
      "@m3/bridge": pkg("bridge"),
      "@m3/commands": pkg("commands"),
      "@m3/gateway": pkg("gateway"),
      "@m3/gateway-protocol": pkg("gateway-protocol"),
      "@m3/plugin-sdk": pkg("plugin-sdk"),
    },
  },
});
