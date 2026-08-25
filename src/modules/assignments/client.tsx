import type { ClientModule } from "../types"

export { Assignees, assignmentsKey, type Assignment } from "./assignees"

// No page and no nav entry: this module is a component other pages embed, plus
// the visibility helpers other modules import from ./visibility.
export default { id: "assignments", routes: [] } satisfies ClientModule
