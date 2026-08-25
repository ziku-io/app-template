import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BuildingsIcon, CircleDashedIcon, CurrencyEurIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react"
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type DataTableColumn,
} from "@ziku/ui"

import { del, get, post } from "../lib/api"

const STATUSES = ["Lead", "Active", "On hold", "Done"] as const

interface Project {
  id: string
  name: string
  client: string
  status: (typeof STATUSES)[number]
  budget: number
  createdAt: string
}

const euros = (n: number) => `€${n.toLocaleString("en-GB")}`

export function ProjectsPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => get<{ rows: Project[]; total: number }>("/projects"),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["projects"] })
  const create = useMutation({
    mutationFn: (body: Omit<Project, "id" | "createdAt">) => post<Project>("/projects", body),
    onSuccess: () => {
      invalidate()
      setOpen(false)
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => del(`/projects/${id}`),
    onSuccess: invalidate,
  })

  const columns: DataTableColumn<Project>[] = [
    { key: "name", header: "Project", className: "font-medium" },
    { key: "client", header: "Client", icon: BuildingsIcon, facet: true },
    {
      key: "status",
      header: "Status",
      icon: CircleDashedIcon,
      facet: true,
      order: [...STATUSES],
      render: (r) => (
        <Badge variant={r.status === "Done" ? "default" : "secondary"}>{r.status}</Badge>
      ),
    },
    {
      key: "budget",
      header: "Budget",
      icon: CurrencyEurIcon,
      value: (r) => r.budget,
      render: (r) => euros(r.budget),
      className: "text-right tabular-nums",
    },
    {
      key: "actions",
      header: "",
      sortable: false,
      render: (r) => (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${r.name}`}
          onClick={() => remove.mutate(r.id)}
        >
          <TrashIcon />
        </Button>
      ),
    },
  ]

  const rows = data?.rows ?? []

  return (
    <>
      <PageHeader
        title="Projects"
        description="Everything the studio is working on."
        actions={
          <Button onClick={() => setOpen(true)}>
            <PlusIcon /> New project
          </Button>
        }
      />

      {!isLoading && rows.length === 0 ? (
        <EmptyState
          icon={BuildingsIcon}
          title="No projects yet"
          description="Create the first one to see the table, filters and saved views."
          action={
            <Button onClick={() => setOpen(true)}>
              <PlusIcon /> New project
            </Button>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={isLoading}
          rowId={(p) => p.id}
          viewKey="projects"
          defaultSort={{ key: "name", dir: "asc" }}
          searchPlaceholder="Search projects…"
        />
      )}

      <NewProjectDialog
        open={open}
        onOpenChange={setOpen}
        pending={create.isPending}
        onSubmit={(body) => create.mutate(body)}
      />
    </>
  )
}

function NewProjectDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onSubmit: (body: { name: string; client: string; status: Project["status"]; budget: number }) => void
}) {
  const [status, setStatus] = useState<Project["status"]>("Lead")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            onSubmit({
              name: String(f.get("name")),
              client: String(f.get("client")),
              status,
              budget: Number(f.get("budget")) || 0,
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required autoFocus />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="client">Client</Label>
              <Input id="client" name="client" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as Project["status"])}>
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="budget">Budget</Label>
              <Input id="budget" name="budget" type="number" min={0} defaultValue={0} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
