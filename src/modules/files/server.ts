import type { ServerModule } from "../types"
import { nested, routes } from "./routes"

export default {
  id: "files",
  basePath: "/files",
  routes,
  // Serves /api/v1/{parentType}/{parentId}/files for any parent.
  extraMounts: [{ path: "/:parentType/:parentId/files", routes: nested }],
} satisfies ServerModule
