import type { ServerModule } from "../types"
import { routes } from "./routes"

export default { id: "intake", basePath: "/intake", routes } satisfies ServerModule
