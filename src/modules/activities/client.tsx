import type { ClientModule } from "../types"

export { ActivityFeed } from "./feed"

// No page and no nav entry: this module is a component other pages embed.
export default { id: "activity", routes: [] } satisfies ClientModule
