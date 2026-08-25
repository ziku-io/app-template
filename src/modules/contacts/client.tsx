import { AddressBookIcon } from "@phosphor-icons/react"

import type { ClientModule } from "../types"
import { ContactsPage } from "./page"

// Re-exported so other modules can embed the panel without reaching into files.
export { ContactList, contactsKey, type Contact } from "./list"

export default {
  id: "contacts",
  nav: [{ title: "Contacts", href: "/contacts", icon: AddressBookIcon, group: "Workspace" }],
  routes: [{ path: "/contacts", element: <ContactsPage /> }],
} satisfies ClientModule
