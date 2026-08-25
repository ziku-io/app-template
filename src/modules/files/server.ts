import type { ServerModule } from "../types"
import { routes } from "./routes"

export default { id: "files", basePath: "/api/files", routes } satisfies ServerModule
