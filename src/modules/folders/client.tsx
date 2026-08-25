import { TreeStructureIcon } from "@phosphor-icons/react"

import type { ClientModule } from "../types"
import { FoldersPage } from "./page"

export default {
  id: "folders",
  nav: [{ title: "Folders", href: "/folders", icon: TreeStructureIcon, group: "Workspace" }],
  routes: [{ path: "/folders", element: <FoldersPage /> }],
} satisfies ClientModule
