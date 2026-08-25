import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PaperPlaneRightIcon, TrashIcon } from "@phosphor-icons/react"
import { Avatar, AvatarFallback, Button, Textarea } from "@ziku/ui"

import { del, get, post, type Json } from "@/client/lib/api"

import type { Activity as ActivityRow } from "./schema"

type Activity = Json<ActivityRow>

const initials = (name?: string | null) =>
  (name ?? "?")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()

const when = (iso: string) => new Date(iso).toLocaleString()

/** Notes and events on one record. Drop it onto any detail page. */
export function ActivityFeed({
  entityType,
  entityId,
  className,
}: {
  entityType: string
  entityId: string
  className?: string
}) {
  const queryClient = useQueryClient()
  const key = ["activity", entityType, entityId]
  const params = `?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`

  const { data } = useQuery({
    queryKey: key,
    queryFn: () => get<{ rows: Activity[] }>(`/activity${params}`),
  })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key })

  const add = useMutation({
    mutationFn: (text: string) => post<Activity>("/activity", { entityType, entityId, text }),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => del(`/activity/${id}`),
    onSuccess: invalidate,
  })

  return (
    <div className={className}>
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const field = e.currentTarget.elements.namedItem("text") as HTMLTextAreaElement
          const text = field.value.trim()
          if (!text) return
          add.mutate(text)
          field.value = ""
        }}
      >
        <Textarea name="text" placeholder="Add a note…" rows={2} />
        <Button type="submit" size="sm" className="justify-self-end" disabled={add.isPending}>
          <PaperPlaneRightIcon /> Post
        </Button>
      </form>

      <ol className="mt-6 grid gap-4">
        {(data?.rows ?? []).map((a) => (
          <li key={a.id} className="flex gap-3 text-sm">
            <Avatar size="sm">
              <AvatarFallback>{initials(a.userName)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="font-medium">{a.userName ?? "Someone"}</span>
                <span className="text-xs text-muted-foreground">{when(a.createdAt)}</span>
                {a.kind !== "note" && (
                  <span className="text-xs text-muted-foreground">· {a.kind}</span>
                )}
              </div>
              <p className="whitespace-pre-wrap">{a.text}</p>
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Delete note"
              onClick={() => remove.mutate(a.id)}
            >
              <TrashIcon />
            </Button>
          </li>
        ))}
        {data?.rows.length === 0 && (
          <li className="text-sm text-muted-foreground">Nothing yet.</li>
        )}
      </ol>
    </div>
  )
}
