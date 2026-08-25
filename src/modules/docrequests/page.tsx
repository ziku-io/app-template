import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CircleDashedIcon,
  FileArrowUpIcon,
  FileTextIcon,
  PlusIcon,
  TrashIcon,
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
  Textarea,
  toast,
  type DataTableColumn,
} from "@ziku/ui"

import { del, get, post, type Json } from "@/client/lib/api"

import type { DocumentRequest as DocumentRequestRow } from "./schema"

type DocumentRequest = Json<DocumentRequestRow>

const STATUSES = ["open", "fulfilled", "cancelled"] as const

interface RequestPage {
  rows: DocumentRequest[]
  nextPageToken: string | null
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  open: "default",
  fulfilled: "secondary",
  cancelled: "outline",
}

export function DocumentRequestsPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ["document-requests"],
    queryFn: () => get<RequestPage>("/document-requests?sort_by=-created_at"),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["document-requests"] })

  const create = useMutation({
    mutationFn: (values: { title: string; notes: string | null }) =>
      post<DocumentRequest>("/document-requests", values),
    onSuccess: () => {
      invalidate()
      setOpen(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const cancel = useMutation({
    mutationFn: (id: string) => post<DocumentRequest>(`/document-requests/${id}:cancel`, {}),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => del(`/document-requests/${id}`),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  })

  const columns: DataTableColumn<DocumentRequest>[] = [
    { key: "title", header: "Document", icon: FileTextIcon, className: "font-medium" },
    {
      key: "status",
      header: "Status",
      icon: CircleDashedIcon,
      facet: true,
      order: [...STATUSES],
      render: (r) => <Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge>,
    },
    {
      key: "createdAt",
      header: "Asked",
      render: (r) => new Date(r.createdAt).toLocaleDateString(),
    },
    {
      key: "fulfilledAt",
      header: "Fulfilled",
      value: (r) => r.fulfilledAt ?? "",
      render: (r) => (r.fulfilledAt ? new Date(r.fulfilledAt).toLocaleDateString() : "—"),
    },
    {
      key: "actions",
      header: "",
      sortable: false,
      render: (r) => (
        <div className="flex justify-end gap-1">
          {r.status === "open" && (
            <Button variant="ghost" size="sm" onClick={() => cancel.mutate(r.id)}>
              Cancel
            </Button>
          )}
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
        title="Document requests"
        description="What you have asked people to send, and what has arrived."
        actions={
          <Button onClick={() => setOpen(true)}>
            <PlusIcon /> New request
          </Button>
        }
      />

      {!isLoading && rows.length === 0 ? (
        <EmptyState
          icon={FileArrowUpIcon}
          title="Nothing outstanding"
          description="Ask for a document and it will show up here until the file arrives."
          action={
            <Button onClick={() => setOpen(true)}>
              <PlusIcon /> New request
            </Button>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={isLoading}
          rowId={(r) => r.id}
          viewKey="document-requests"
          defaultSort={{ key: "createdAt", dir: "desc" }}
          searchPlaceholder="Search requests…"
        />
      )}

      <NewRequestDialog
        open={open}
        onOpenChange={setOpen}
        pending={create.isPending}
        onSubmit={(values) => create.mutate(values)}
      />
    </>
  )
}

function NewRequestDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onSubmit: (values: { title: string; notes: string | null }) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            const notes = String(f.get("notes") ?? "").trim()
            onSubmit({ title: String(f.get("title")), notes: notes || null })
          }}
        >
          <DialogHeader>
            <DialogTitle>Request a document</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="title">What do you need?</Label>
              <Input
                id="title"
                name="title"
                required
                autoFocus
                maxLength={300}
                placeholder="2024 signed accounts"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={3} maxLength={5000} />
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
