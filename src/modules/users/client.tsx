import { UsersIcon } from "@phosphor-icons/react"

import type { ClientModule } from "../types"
import { UsersPage } from "./page"

export default {
  id: "users",
  nav: [{ title: "Users", href: "/users", icon: UsersIcon, group: "Account", roles: ["admin"] }],
  routes: [{ path: "/users", element: <UsersPage />, roles: ["admin"] }],
} satisfies ClientModule
