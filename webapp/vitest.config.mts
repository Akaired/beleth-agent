import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests for the pure parts of `src/lib` — no Next runtime, no network, no
 * database. `server-only` is a build-time guard with no runtime behaviour, so it
 * is aliased to an empty module: that lets the forum sanitiser, which is the most
 * security-relevant pure function in the webapp, be tested directly.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
