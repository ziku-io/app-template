import type { ServerModule } from "../types"
import { routes } from "./routes"

export default { id: "tasks", basePath: "/tasks", routes } satisfies ServerModule
