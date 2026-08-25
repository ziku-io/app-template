import { CheckSquareIcon } from "@phosphor-icons/react"

import type { ClientModule } from "../types"
import { TasksPage } from "./page"

export default {
  id: "tasks",
  nav: [{ title: "Tasks", href: "/tasks", icon: CheckSquareIcon, group: "Workspace" }],
  routes: [{ path: "/tasks", element: <TasksPage /> }],
} satisfies ClientModule
