import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CrownIcon, UserMinusIcon, UserPlusIcon } from "@phosphor-icons/react"
import { Avatar, AvatarFallback, Badge, Button, Input, Label } from "@ziku/ui"

import { del, get, post, type Json } from "@/client/lib/api"

import type { Assignment as AssignmentRow } from "./schema"

export type Assignment = Json<AssignmentRow>

/** Every call goes through the versioned API; `api()` prepends `/api`. */
const BASE = "/assignments"

export function assignmentsKey(entityType: string, entityId: string) {
  return ["assignments", entityType, entityId]
}

const initials = (id: string) => id.slice(0, 2).toUpperCase()

/**
 * Who owns or works one record. Drop it onto any detail page:
 * `<Assignees entityType="project" entityId={project.id} />`.
 *
 * Removing the last owner is refused by the server with a 409; the error is
 * surfaced rather than swallowed, because "nothing happened" is the worst
 * possible answer to that click.
 */
export function Assignees({
  entityType,
  entityId,
  className,
}: {
  entityType: string
  entityId: string
  className?: string
}) {
  const queryClient = useQueryClient()
  const key = assignmentsKey(entityType, entityId)
  const params = `?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}&sort_by=role`

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => get<{ rows: Assignment[]; nextPageToken: string | null }>(`${BASE}${params}`),
  })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key })

  const assign = useMutation({
    mutationFn: (values: { userId: string; role: "owner" | "member" }) =>
      post<Assignment>(BASE, { entityType, entityId, ...values }),
    onSuccess: invalidate,
  })
  const unassign = useMutation({
    mutationFn: (id: string) => del(`${BASE}/${id}`),
    onSuccess: invalidate,
  })
  const transfer = useMutation({
    mutationFn: ({ id, toUserId }: { id: string; toUserId: string }) =>
      post<Assignment>(`${BASE}/${id}:transferOwnership`, { toUserId }),
    onSuccess: invalidate,
  })

  const rows = data?.rows ?? []
  const owners = rows.filter((a) => a.role === "owner")
  const problem = unassign.error ?? assign.error ?? transfer.error

  return (
    <div className={className}>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          const form = e.currentTarget
          const userId = String(new FormData(form).get("userId") ?? "").trim()
          // Guard first: the server 422s a blank userId, so skip the round trip.
          if (!userId) return
          assign.mutate({ userId, role: owners.length === 0 ? "owner" : "member" })
          form.reset()
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="assignee-user">User id</Label>
          <Input id="assignee-user" name="userId" required placeholder="usr_…" />
        </div>
        <Button type="submit" size="sm" disabled={assign.isPending}>
          <UserPlusIcon /> Assign
        </Button>
      </form>

      {problem && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {problem.message}
        </p>
      )}

      <ul className="mt-6 grid gap-3">
        {rows.map((assignment) => (
          <li key={assignment.id} className="flex items-center gap-3 text-sm">
            <Avatar size="sm">
              <AvatarFallback>{initials(assignment.userId)}</AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 truncate font-medium">{assignment.userId}</span>
            {assignment.role === "owner" ? (
              <Badge variant="secondary">
                <CrownIcon /> Owner
              </Badge>
            ) : (
              owners.length === 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => transfer.mutate({ id: owners[0].id, toUserId: assignment.userId })}
                >
                  Make owner
                </Button>
              )
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Unassign ${assignment.userId}`}
              onClick={() => unassign.mutate(assignment.id)}
            >
              <UserMinusIcon />
            </Button>
          </li>
        ))}
        {!isLoading && rows.length === 0 && (
          <li className="text-sm text-muted-foreground">Nobody is assigned yet.</li>
        )}
      </ul>
    </div>
  )
}
