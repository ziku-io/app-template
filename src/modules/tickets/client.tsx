import { TicketIcon } from "@phosphor-icons/react"

import type { ClientModule } from "../types"
import { TicketsPage } from "./page"

export default {
  id: "tickets",
  nav: [{ title: "Tickets", href: "/tickets", icon: TicketIcon, group: "Workspace" }],
  routes: [{ path: "/tickets", element: <TicketsPage /> }],
} satisfies ClientModule
