import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { UserIcon } from "@phosphor-icons/react"
import {
  Badge,
  DataTable,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  type DataTableColumn,
} from "@ziku/ui"

import { get, patch } from "@/client/lib/api"

interface AppUser {
  id: string
  name: string
  email: string
  role: string | null
  emailVerified: boolean
  createdAt: string
}

export function UsersPage() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => get<{ rows: AppUser[] }>("/users"),
  })

  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => patch(`/users/${id}`, { role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
    onError: (e: Error) => toast.error(e.message),
  })

  const columns: DataTableColumn<AppUser>[] = [
    { key: "name", header: "Name", icon: UserIcon, className: "font-medium" },
    { key: "email", header: "Email" },
    {
      key: "emailVerified",
      header: "Verified",
      facet: true,
      value: (u) => (u.emailVerified ? "Yes" : "No"),
      render: (u) => (
        <Badge variant={u.emailVerified ? "secondary" : "outline"}>
          {u.emailVerified ? "Yes" : "No"}
        </Badge>
      ),
    },
    {
      key: "role",
      header: "Role",
      facet: true,
      value: (u) => u.role ?? "member",
      render: (u) => (
        <Select
          value={u.role ?? "member"}
          onValueChange={(role) => setRole.mutate({ id: u.id, role })}
        >
          <SelectTrigger className="h-8 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">admin</SelectItem>
            <SelectItem value="member">member</SelectItem>
          </SelectContent>
        </Select>
      ),
    },
  ]

  return (
    <>
      <PageHeader title="Users" description="Everyone with access to this app." />
      <DataTable
        columns={columns}
        data={data?.rows ?? []}
        loading={isLoading}
        rowId={(u) => u.id}
        viewKey="users"
        searchPlaceholder="Search people…"
      />
    </>
  )
}
