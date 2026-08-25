import type { ServerModule } from "../types"
import { routes } from "./routes"

export default { id: "projects", basePath: "/api/projects", routes } satisfies ServerModule
