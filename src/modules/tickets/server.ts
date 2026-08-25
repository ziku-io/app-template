import type { ServerModule } from "../types"
import { routes } from "./routes"

export default { id: "tickets", basePath: "/tickets", routes } satisfies ServerModule
