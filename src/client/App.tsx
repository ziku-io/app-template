import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router"
import { ChartBarIcon, FolderIcon, GearIcon, HouseIcon } from "@phosphor-icons/react"
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

import { ForgotPasswordPage, LoginPage, RegisterPage } from "./pages/auth"
import { ProjectsPage } from "./pages/projects"
import { authClient, useSession } from "./lib/auth-client"

const nav: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { title: "Dashboard", href: "/", icon: HouseIcon },
      { title: "Projects", href: "/projects", icon: FolderIcon },
      { title: "Reports", href: "/reports", icon: ChartBarIcon },
    ],
  },
  { label: "Account", items: [{ title: "Settings", href: "/settings", icon: GearIcon }] },
]

export function App() {
  const { data: session, isPending } = useSession()
  const location = useLocation()
  const navigate = useNavigate()

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
      user={{ name: session.user.name, email: session.user.email, avatarUrl: session.user.image ?? undefined }}
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
                  .map((i) => ({ id: i.href, label: i.title, icon: i.icon, onSelect: () => navigate(i.href) })),
              },
            ]}
          />
        </>
      }
    >
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/reports" element={<Placeholder title="Reports" />} />
        <Route path="/settings" element={<Placeholder title="Settings" />} />
        <Route path="*" element={<Placeholder title="Not found" />} />
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
        {["Projects", "Clients", "Open tasks"].map((t) => (
          <div key={t} className="rounded-md border bg-card p-5">
            <div className="text-sm text-muted-foreground">{t}</div>
            <div className="mt-1 text-2xl font-semibold">—</div>
          </div>
        ))}
      </div>
    </>
  )
}

function Placeholder({ title }: { title: string }) {
  return <PageHeader title={title} description="Replace this with the real page." />
}
