import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

const apiPort = process.env.PORT ?? "3000"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  root: "src/client",
  build: { outDir: "../../dist/client", emptyOutDir: true },
  // Only used by `pnpm dev`; in production one Hono process serves both.
  // Follows PORT so the API and this proxy cannot drift apart.
  server: { proxy: { "/api": `http://localhost:${apiPort}` } },
})
