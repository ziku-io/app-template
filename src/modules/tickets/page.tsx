import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CircleDashedIcon,
  HashIcon,
  PlusIcon,
  TicketIcon,
  TrashIcon,
  WarningIcon,
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
  toast,
  type DataTableColumn,
} from "@ziku/ui"

import { del, get, post, type Json } from "@/client/lib/api"

import type { Ticket as TicketRow } from "./schema"

type Ticket = Json<TicketRow>

const STATUSES = ["new", "open", "pending", "resolved", "closed"] as const
const PRIORITIES = ["low", "normal", "high", "urgent"] as const

/** Cursor-paged list envelope from the API. */
interface TicketPage {
  rows: Ticket[]
  nextPageToken: string | null
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  new: "default",
  open: "default",
  pending: "secondary",
  resolved: "secondary",
  closed: "outline",
}

export function TicketsPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ["tickets"],
    queryFn: () => get<TicketPage>("/tickets?sort_by=-created_at"),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["tickets"] })

  const create = useMutation({
    mutationFn: (values: { subject: string; priority: string }) => post<Ticket>("/tickets", values),
    onSuccess: () => {
      invalidate()
      setOpen(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const close = useMutation({
    // Closing is a verb, not a status field the client gets to set.
    mutationFn: (id: string) => post<Ticket>(`/tickets/${id}:close`, {}),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => del(`/tickets/${id}`),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  })

  const columns: DataTableColumn<Ticket>[] = [
    { key: "ref", header: "Ref", icon: HashIcon, className: "font-mono text-xs" },
    { key: "subject", header: "Subject", icon: TicketIcon, className: "font-medium" },
    {
      key: "status",
      header: "Status",
      icon: CircleDashedIcon,
      facet: true,
      order: [...STATUSES],
      render: (t) => <Badge variant={STATUS_VARIANT[t.status] ?? "outline"}>{t.status}</Badge>,
    },
    {
      key: "priority",
      header: "Priority",
      icon: WarningIcon,
      facet: true,
      order: [...PRIORITIES],
      value: (t) => t.priority ?? "normal",
      render: (t) => (
        <Badge variant={t.priority === "urgent" || t.priority === "high" ? "default" : "secondary"}>
          {t.priority ?? "normal"}
        </Badge>
      ),
    },
    {
      key: "createdAt",
      header: "Opened",
      render: (t) => new Date(t.createdAt).toLocaleDateString(),
    },
    {
      key: "actions",
      header: "",
      sortable: false,
      render: (t) => (
        <div className="flex justify-end gap-1">
          {t.status !== "closed" && (
            <Button variant="ghost" size="sm" onClick={() => close.mutate(t.id)}>
              Close
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${t.ref}`}
            onClick={() => remove.mutate(t.id)}
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
        title="Tickets"
        description="Everything waiting on someone."
        actions={
          <Button onClick={() => setOpen(true)}>
            <PlusIcon /> New ticket
          </Button>
        }
      />

      {!isLoading && rows.length === 0 ? (
        <EmptyState
          icon={TicketIcon}
          title="No tickets yet"
          description="Raise the first one to see the queue, filters and saved views."
          action={
            <Button onClick={() => setOpen(true)}>
              <PlusIcon /> New ticket
            </Button>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={isLoading}
          rowId={(t) => t.id}
          viewKey="tickets"
          defaultSort={{ key: "createdAt", dir: "desc" }}
          searchPlaceholder="Search tickets…"
        />
      )}

      <NewTicketDialog
        open={open}
        onOpenChange={setOpen}
        pending={create.isPending}
        onSubmit={(values) => create.mutate(values)}
      />
    </>
  )
}

function NewTicketDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onSubmit: (values: { subject: string; priority: string }) => void
}) {
  const [priority, setPriority] = useState<string>("normal")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            onSubmit({ subject: String(f.get("subject")), priority })
          }}
        >
          <DialogHeader>
            <DialogTitle>New ticket</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="subject">Subject</Label>
              <Input id="subject" name="subject" required autoFocus maxLength={500} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="priority">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
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
