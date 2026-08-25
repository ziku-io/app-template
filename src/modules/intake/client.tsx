import { TrayIcon } from "@phosphor-icons/react"

import type { ClientModule } from "../types"
import { IntakePage } from "./page"

/**
 * Admin-only on both the nav item and the route, so a member cannot reach the
 * page by typing the URL. That is a convenience, not the boundary — the server
 * routes carry `requireAdmin`, and that is the check that counts.
 */
export default {
  id: "intake",
  nav: [{ title: "Intake", href: "/intake", icon: TrayIcon, group: "Account", roles: ["admin"] }],
  routes: [{ path: "/intake", element: <IntakePage />, roles: ["admin"] }],
} satisfies ClientModule
