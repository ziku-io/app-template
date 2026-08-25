import { PaperclipIcon } from "@phosphor-icons/react"

import type { ClientModule } from "../types"
import { FilesPage } from "./page"

export default {
  id: "files",
  nav: [{ title: "Files", href: "/files", icon: PaperclipIcon, group: "Workspace" }],
  routes: [{ path: "/files", element: <FilesPage /> }],
} satisfies ClientModule
