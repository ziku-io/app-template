import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  EnvelopeSimpleIcon,
  PhoneIcon,
  StarIcon,
  TrashIcon,
  UserPlusIcon,
} from "@phosphor-icons/react"
import { Badge, Button, Input, Label } from "@ziku/ui"

import { del, get, post, type Json } from "@/client/lib/api"

import type { Contact as ContactRow } from "./schema"

export type Contact = Json<ContactRow>

/** Every call goes through the versioned API; `api()` prepends `/api`. */
const BASE = "/contacts"

export function contactsKey(entityType: string, entityId: string) {
  return ["contacts", entityType, entityId]
}

/**
 * Contacts on one record. Drop it onto any detail page:
 * `<ContactList entityType="project" entityId={project.id} />`.
 */
export function ContactList({
  entityType,
  entityId,
  className,
}: {
  entityType: string
  entityId: string
  className?: string
}) {
  const queryClient = useQueryClient()
  const key = contactsKey(entityType, entityId)
  const params = `?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}&sort_by=name`

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => get<{ rows: Contact[]; nextPageToken: string | null }>(`${BASE}${params}`),
  })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key })

  const add = useMutation({
    mutationFn: (values: {
      name: string
      email: string | null
      phone: string | null
      role: string | null
    }) => post<Contact>(BASE, { entityType, entityId, ...values }),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => del(`${BASE}/${id}`),
    onSuccess: invalidate,
  })
  // The server demotes the previous primary in the same transaction, so the
  // list only ever shows one badge.
  const promote = useMutation({
    mutationFn: (id: string) => post<Contact>(`${BASE}/${id}:makePrimary`, {}),
    onSuccess: invalidate,
  })

  const rows = data?.rows ?? []

  return (
    <div className={className}>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          const form = e.currentTarget
          const f = new FormData(form)
          const name = String(f.get("name") ?? "").trim()
          // Guard first: the server rejects a blank name with a 422, so there is
          // no point spending a round trip on it.
          if (!name) return
          add.mutate({
            name,
            email: String(f.get("email") ?? "").trim() || null,
            phone: String(f.get("phone") ?? "").trim() || null,
            role: String(f.get("role") ?? "").trim() || null,
          })
          form.reset()
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="contact-name">Name</Label>
          <Input id="contact-name" name="name" required placeholder="Ada Lovelace" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="contact-email">Email</Label>
          <Input id="contact-email" name="email" type="email" placeholder="ada@example.com" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="contact-role">Role</Label>
          <Input id="contact-role" name="role" placeholder="Billing" />
        </div>
        <Button type="submit" size="sm" disabled={add.isPending}>
          <UserPlusIcon /> Add
        </Button>
      </form>

      <ul className="mt-6 grid gap-3">
        {rows.map((contact) => (
          <li key={contact.id} className="flex items-center gap-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="font-medium">{contact.name}</span>
                {contact.role && (
                  <span className="text-xs text-muted-foreground">{contact.role}</span>
                )}
                {contact.isPrimary && <Badge variant="secondary">Primary</Badge>}
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                {contact.email && (
                  <span className="inline-flex items-center gap-1">
                    <EnvelopeSimpleIcon /> {contact.email}
                  </span>
                )}
                {contact.phone && (
                  <span className="inline-flex items-center gap-1">
                    <PhoneIcon /> {contact.phone}
                  </span>
                )}
              </div>
            </div>
            {!contact.isPrimary && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Make ${contact.name} the primary contact`}
                onClick={() => promote.mutate(contact.id)}
              >
                <StarIcon />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Delete ${contact.name}`}
              onClick={() => remove.mutate(contact.id)}
            >
              <TrashIcon />
            </Button>
          </li>
        ))}
        {!isLoading && rows.length === 0 && (
          <li className="text-sm text-muted-foreground">No contacts yet.</li>
        )}
      </ul>
    </div>
  )
}
