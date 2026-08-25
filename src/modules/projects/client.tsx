import { FolderIcon } from "@phosphor-icons/react"

import type { ClientModule } from "../types"
import { ProjectsPage } from "./page"

export default {
  id: "projects",
  nav: [{ title: "Projects", href: "/projects", icon: FolderIcon, group: "Workspace" }],
  routes: [{ path: "/projects", element: <ProjectsPage /> }],
} satisfies ClientModule
