import { PageHeader } from "@ziku/ui"

import { useSession } from "../lib/auth-client"

export function SettingsPage() {
  const { data: session } = useSession()
  return (
    <>
      <PageHeader title="Settings" description="Your account." />
      <dl className="grid max-w-md gap-3 rounded-md border bg-card p-5 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Name</dt>
          <dd>{session?.user.name}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Email</dt>
          <dd>{session?.user.email}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Role</dt>
          <dd>{(session?.user as { role?: string } | undefined)?.role ?? "member"}</dd>
        </div>
      </dl>
    </>
  )
}
