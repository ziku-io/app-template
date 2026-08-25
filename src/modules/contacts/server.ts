import type { ServerModule } from "../types"
import { routes } from "./routes"

export default { id: "contacts", basePath: "/contacts", routes } satisfies ServerModule
