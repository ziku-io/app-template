import type { ServerModule } from "../types"
import { routes } from "./routes"

// The folder name is `docrequests` because `scripts/sync-modules.ts` uses the
// module id as a JS import identifier — `document-requests` would generate
// `import document-requests from …`, which does not parse. The public path is
// still the plural noun callers expect.
export default { id: "docrequests", basePath: "/document-requests", routes } satisfies ServerModule
