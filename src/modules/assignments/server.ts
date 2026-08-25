import type { ServerModule } from "../types"
import { routes } from "./routes"

export default { id: "assignments", basePath: "/assignments", routes } satisfies ServerModule
