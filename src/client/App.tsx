import { useMemo } from "react"
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router"
import { GearIcon, HouseIcon } from "@phosphor-icons/react"
import {
  AppShell,
  CommandMenu,
  DropdownMenuItem,
  PageHeader,
  SearchTrigger,
  Skeleton,
  Toaster,
  type NavGroup,
} from "@ziku/ui"

import { clientModules } from "@/modules/client.generated"
import type { ModuleNavItem, ModuleRoute } from "@/modules/types"

import { ForgotPasswordPage, LoginPage, RegisterPage } from "./pages/auth"
import { SettingsPage } from "./pages/settings"
import { authClient, useSession } from "./lib/auth-client"

/** Always present, whatever modules are installed. */
const CORE_NAV: ModuleNavItem[] = [
  { title: "Dashboard", href: "/", icon: HouseIcon, group: "Workspace" },
  { title: "Settings", href: "/settings", icon: GearIcon, group: "Account" },
]
const GROUP_ORDER = ["Workspace", "Account"]

/** Sidebar groups, built from the core plus every installed module. */
function buildNav(role: string): NavGroup[] {
  const items = [...CORE_NAV, ...clientModules.flatMap((m) => m.nav ?? [])].filter(
    (i) => !i.roles || i.roles.includes(role),
  )
  const groups = [...new Set([...GROUP_ORDER, ...items.map((i) => i.group ?? "Workspace")])]
  return groups
    .map((label) => ({ label, items: items.filter((i) => (i.group ?? "Workspace") === label) }))
    .filter((g) => g.items.length > 0)
}

export function App() {
  const { data: session, isPending } = useSession()
  const location = useLocation()
  const navigate = useNavigate()

  const role = (session?.user as { role?: string } | undefined)?.role ?? "member"
  const nav = useMemo(() => buildNav(role), [role])
  const moduleRoutes = useMemo<ModuleRoute[]>(
    () => clientModules.flatMap((m) => m.routes).filter((r) => !r.roles || r.roles.includes(role)),
    [role],
  )

  const isAuthRoute = ["/login", "/register", "/forgot-password"].includes(location.pathname)

  if (isPending) {
    return (
      <div className="grid min-h-svh place-items-center p-6">
        <Skeleton className="h-24 w-64" />
      </div>
    )
  }

  if (!session?.user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  // Signed in: the auth pages have nothing left to do.
  if (isAuthRoute) return <Navigate to="/" replace />

  return (
    <AppShell
      brand={<span className="px-1 font-semibold tracking-tight">ziku app</span>}
      nav={nav}
      currentPath={location.pathname}
      user={{
        name: session.user.name,
        email: session.user.email,
        avatarUrl: session.user.image ?? undefined,
      }}
      userMenu={
        <DropdownMenuItem onSelect={() => navigate("/settings")}>
          <GearIcon /> Settings
        </DropdownMenuItem>
      }
      onSignOut={async () => {
        await authClient.signOut()
        navigate("/login")
      }}
      headerActions={
        <>
          <SearchTrigger className="hidden md:inline-flex" />
          <CommandMenu
            groups={[
              {
                heading: "Go to",
                items: nav
                  .flatMap((g) => g.items)
                  .map((i) => ({
                    id: i.href,
                    label: i.title,
                    icon: i.icon,
                    onSelect: () => navigate(i.href),
                  })),
              },
            ]}
          />
        </>
      }
    >
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/settings" element={<SettingsPage />} />
        {moduleRoutes.map((r) => (
          <Route key={r.path} path={r.path} element={r.element} />
        ))}
        <Route
          path="*"
          element={<PageHeader title="Not found" description="No page at this address." />}
        />
      </Routes>
      <Toaster />
    </AppShell>
  )
}

function Dashboard() {
  return (
    <>
      <PageHeader title="Dashboard" description="What this app is for." />
      <div className="grid gap-4 md:grid-cols-3">
        {["Open items", "This week", "Team"].map((t) => (
          <div key={t} className="rounded-md border bg-card p-5">
            <div className="text-sm text-muted-foreground">{t}</div>
            <div className="mt-1 text-2xl font-semibold">—</div>
          </div>
        ))}
      </div>
    </>
  )
}
