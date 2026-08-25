import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  test: {
    // Unit tests only. The API is exercised end to end by ./smoke.sh, which
    // runs against a real server and a real Postgres; see docs/testing.md.
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
})
