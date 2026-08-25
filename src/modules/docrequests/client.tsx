import { FileArrowUpIcon } from "@phosphor-icons/react"

import type { ClientModule } from "../types"
import { DocumentRequestsPage } from "./page"

export default {
  id: "docrequests",
  nav: [
    {
      title: "Document requests",
      href: "/document-requests",
      icon: FileArrowUpIcon,
      group: "Workspace",
    },
  ],
  routes: [{ path: "/document-requests", element: <DocumentRequestsPage /> }],
} satisfies ClientModule
