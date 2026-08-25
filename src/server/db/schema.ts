// Better Auth owns these. Regenerate after changing auth config with:
//   pnpm dlx auth@1.7.1 generate --config src/server/auth.ts --output src/server/db/auth-schema.ts
export * from "./auth-schema"

// Every installed module's tables, written by `pnpm modules:sync`.
export * from "@/modules/schema.generated"
