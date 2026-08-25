import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AddressBookIcon,
  EnvelopeSimpleIcon,
  IdentificationBadgeIcon,
  PhoneIcon,
  StackIcon,
  StarIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { Badge, Button, DataTable, EmptyState, PageHeader, type DataTableColumn } from "@ziku/ui"

import { del, get, post } from "@/client/lib/api"

import type { Contact } from "./list"

const BASE = "/contacts"

export function ContactsPage() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ["contacts"],
    queryFn: () =>
      get<{ rows: Contact[]; nextPageToken: string | null }>(`${BASE}?pageSize=200&sort_by=name`),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["contacts"] })
  const remove = useMutation({
    mutationFn: (id: string) => del(`${BASE}/${id}`),
    onSuccess: invalidate,
  })
  const promote = useMutation({
    mutationFn: (id: string) => post<Contact>(`${BASE}/${id}:makePrimary`, {}),
    onSuccess: invalidate,
  })

  const columns: DataTableColumn<Contact>[] = [
    {
      key: "name",
      header: "Name",
      className: "font-medium",
      render: (r) => (
        <span className="inline-flex items-center gap-2">
          {r.name}
          {r.isPrimary && <Badge variant="secondary">Primary</Badge>}
        </span>
      ),
    },
    { key: "email", header: "Email", icon: EnvelopeSimpleIcon, render: (r) => r.email ?? "—" },
    { key: "phone", header: "Phone", icon: PhoneIcon, render: (r) => r.phone ?? "—" },
    {
      key: "role",
      header: "Role",
      icon: IdentificationBadgeIcon,
      facet: true,
      value: (r) => r.role ?? "—",
      render: (r) => r.role ?? "—",
    },
    { key: "entityType", header: "Attached to", icon: StackIcon, facet: true },
    {
      key: "actions",
      header: "",
      sortable: false,
      render: (r) => (
        <div className="flex justify-end gap-1">
          {!r.isPrimary && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Make ${r.name} the primary contact`}
              onClick={() => promote.mutate(r.id)}
            >
              <StarIcon />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${r.name}`}
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
      <PageHeader title="Contacts" description="Every named person attached to a record." />

      {!isLoading && rows.length === 0 ? (
        <EmptyState
          icon={AddressBookIcon}
          title="No contacts yet"
          description="Contacts are added from the record they belong to, with the <ContactList /> panel."
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={isLoading}
          rowId={(contact) => contact.id}
          viewKey="contacts"
          defaultSort={{ key: "name", dir: "asc" }}
          searchPlaceholder="Search contacts…"
        />
      )}
    </>
  )
}
