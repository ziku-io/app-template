import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckCircleIcon,
  CheckSquareIcon,
  CircleDashedIcon,
  FlagIcon,
  PlusIcon,
  TrashIcon,
  UserIcon,
} from "@phosphor-icons/react"
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
  Textarea,
  type DataTableColumn,
} from "@ziku/ui"

import { del, get, post } from "@/client/lib/api"

/** Same lists as the CHECK constraints, in the order a board should read. */
const STATUSES = ["todo", "doing", "blocked", "done"] as const
const PRIORITIES = ["low", "normal", "high", "urgent"] as const

const UNASSIGNED = "Unassigned"

interface Task {
  id: string
  title: string
  description: string | null
  status: (typeof STATUSES)[number]
  priority: (typeof PRIORITIES)[number]
  assigneeId: string | null
  dueDate: string | null
  parentId: string | null
  completedAt: string | null
  createdAt: string
}

interface Page {
  rows: Task[]
  nextPageToken: string | null
}

export function TasksPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => get<Page>("/tasks?pageSize=200"),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["tasks"] })
  const create = useMutation({
    mutationFn: (body: {
      title: string
      description: string | null
      status: Task["status"]
      priority: Task["priority"]
      assigneeId: string | null
    }) => post<Task>("/tasks", body),
    onSuccess: () => {
      invalidate()
      setOpen(false)
    },
  })
  const complete = useMutation({
    mutationFn: (id: string) => post<Task>(`/tasks/${id}:complete`, {}),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => del(`/tasks/${id}`),
    onSuccess: invalidate,
  })

  const columns: DataTableColumn<Task>[] = [
    { key: "title", header: "Task", className: "font-medium" },
    {
      key: "status",
      header: "Status",
      icon: CircleDashedIcon,
      facet: true,
      // Matches the CHECK list, so grouping reads todo → done rather than
      // alphabetically (blocked, doing, done, todo).
      order: [...STATUSES],
      render: (r) => (
        <Badge variant={r.status === "done" ? "default" : "secondary"}>{r.status}</Badge>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      icon: FlagIcon,
      facet: true,
      order: [...PRIORITIES],
    },
    {
      key: "assigneeId",
      header: "Assignee",
      icon: UserIcon,
      facet: true,
      value: (r) => r.assigneeId ?? UNASSIGNED,
    },
    {
      key: "actions",
      header: "",
      sortable: false,
      render: (r) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Complete ${r.title}`}
            disabled={r.status === "done"}
            onClick={() => complete.mutate(r.id)}
          >
            <CheckCircleIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${r.title}`}
            onClick={() => remove.mutate(r.id)}
          >
            <TrashIcon />
          </Button>
        </div>
      ),
    },
  ]

  const rows = data?.rows ?? []

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Work items, with one level of subtasks."
        actions={
          <Button onClick={() => setOpen(true)}>
            <PlusIcon /> New task
          </Button>
        }
      />

      {!isLoading && rows.length === 0 ? (
        <EmptyState
          icon={CheckSquareIcon}
          title="No tasks yet"
          description="Create the first one to see the table, filters and saved views."
          action={
            <Button onClick={() => setOpen(true)}>
              <PlusIcon /> New task
            </Button>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={isLoading}
          rowId={(t) => t.id}
          viewKey="tasks"
          defaultSort={{ key: "title", dir: "asc" }}
          searchPlaceholder="Search tasks…"
        />
      )}

      <NewTaskDialog
        open={open}
        onOpenChange={setOpen}
        pending={create.isPending}
        onSubmit={(body) => create.mutate(body)}
      />
    </>
  )
}

function NewTaskDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onSubmit: (body: {
    title: string
    description: string | null
    status: Task["status"]
    priority: Task["priority"]
    assigneeId: string | null
  }) => void
}) {
  const [status, setStatus] = useState<Task["status"]>("todo")
  const [priority, setPriority] = useState<Task["priority"]>("normal")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            onSubmit({
              title: String(f.get("title")),
              description: String(f.get("description")) || null,
              status,
              priority,
              assigneeId: String(f.get("assigneeId")) || null,
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" required autoFocus />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" name="description" rows={3} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as Task["status"])}>
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
              <Label htmlFor="priority">Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as Task["priority"])}>
                <SelectTrigger id="priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="assigneeId">Assignee</Label>
              <Input id="assigneeId" name="assigneeId" placeholder="User id" />
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
