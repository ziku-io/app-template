import type { ServerModule } from "../types"
import { routes } from "./routes"

export default { id: "users", basePath: "/users", routes } satisfies ServerModule
