import type { ServerModule } from "../types"
import { nested, routes } from "./routes"

export default {
  id: "activities",
  basePath: "/activities",
  routes,
  // Serves /api/v1/{parentType}/{parentId}/activities for any parent.
  extraMounts: [{ path: "/:parentType/:parentId/activities", routes: nested }],
} satisfies ServerModule
