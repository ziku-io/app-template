import type { ServerModule } from "../types"
import { routes } from "./routes"

export default { id: "folders", basePath: "/folders", routes } satisfies ServerModule
