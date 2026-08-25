import type { ServerModule } from "../types"
import { routes } from "./routes"

export default { id: "activity", basePath: "/api/activity", routes } satisfies ServerModule
