import type { ReactNode } from "react"
import type { Hono } from "hono"
import type { Icon } from "@phosphor-icons/react"

/**
 * A module is a self-contained feature: its own tables, API routes, pages and
 * navigation. Modules are discovered by `pnpm modules:sync`, which writes the
 * registries the server and client import. Deleting a module's folder and
 * re-syncing removes the feature completely.
 */

export interface ServerModule {
  id: string
  /** Where the routes mount, e.g. "/api/files". */
  basePath: string
  routes: Hono
}

export interface ModuleNavItem {
  title: string
  href: string
  icon?: Icon
  /** Sidebar group. Unknown groups are appended in module order. */
  group?: string
  /** Only show for these roles. Omit for everyone. */
  roles?: string[]
}

export interface ModuleRoute {
  path: string
  element: ReactNode
  roles?: string[]
}

export interface ClientModule {
  id: string
  nav?: ModuleNavItem[]
  routes: ModuleRoute[]
}

/** Shape of every module.json, read by the setup and sync scripts. */
export interface ModuleManifest {
  id: string
  title: string
  description: string
  /** Other module ids this one needs. */
  requires?: string[]
  /** Extra npm packages, installed by setup when the module is kept. */
  dependencies?: Record<string, string>
  /** Env keys the module needs, written into .env by setup. */
  env?: { key: string; default?: string; description: string }[]
  /** Cannot be removed. */
  core?: boolean
}
