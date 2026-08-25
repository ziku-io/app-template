import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { EnvelopeSimpleIcon, TrashIcon, TrayIcon, UserIcon } from "@phosphor-icons/react"
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  toast,
  type DataTableColumn,
} from "@ziku/ui"

import { del, get, type Json } from "@/client/lib/api"

import type { IntakeSubmission as IntakeSubmissionRow } from "./schema"

type IntakeSubmission = Json<IntakeSubmissionRow>

const KINDS = ["contact", "enquiry", "waitlist"] as const

interface SubmissionPage {
  rows: IntakeSubmission[]
  nextPageToken: string | null
}

export function IntakePage() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ["intake"],
    queryFn: () => get<SubmissionPage>("/v1/intake?sort_by=-created_at"),
  })

  const remove = useMutation({
    mutationFn: (id: string) => del(`/v1/intake/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["intake"] }),
    onError: (e: Error) => toast.error(e.message),
  })

  const columns: DataTableColumn<IntakeSubmission>[] = [
    {
      key: "kind",
      header: "Kind",
      facet: true,
      order: [...KINDS],
      render: (s) => <Badge variant="secondary">{s.kind}</Badge>,
    },
    { key: "name", header: "Name", icon: UserIcon, className: "font-medium" },
    { key: "email", header: "Email", icon: EnvelopeSimpleIcon },
    {
      key: "message",
      header: "Message",
      sortable: false,
      render: (s) => <span className="line-clamp-2 text-muted-foreground">{s.message}</span>,
    },
    {
      key: "createdAt",
      header: "Received",
      render: (s) => new Date(s.createdAt).toLocaleString(),
    },
    {
      key: "actions",
      header: "",
      sortable: false,
      render: (s) => (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete submission from ${s.name}`}
          onClick={() => remove.mutate(s.id)}
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
        title="Intake"
        description="Everything sent through the public form. IP addresses are stored hashed, never in the clear."
      />

      {!isLoading && rows.length === 0 ? (
        <EmptyState
          icon={TrayIcon}
          title="Nothing yet"
          description="Submissions from the public form land here."
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={isLoading}
          rowId={(s) => s.id}
          viewKey="intake"
          defaultSort={{ key: "createdAt", dir: "desc" }}
          searchPlaceholder="Search submissions…"
        />
      )}
    </>
  )
}
