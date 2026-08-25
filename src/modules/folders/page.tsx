import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CaretDownIcon,
  CaretRightIcon,
  FolderIcon,
  FolderOpenIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
} from "@ziku/ui"

import { del, get, post } from "@/client/lib/api"

interface Folder {
  id: string
  name: string
  parentId: string | null
  createdAt: string
}

interface Page {
  rows: Folder[]
  nextPageToken: string | null
}

interface Node extends Folder {
  children: Node[]
}

/** Flat rows → tree. Rows whose parent is not in the page stay at the top
 *  level rather than disappearing: a folder you cannot see is a folder you
 *  cannot fix. */
function toTree(rows: Folder[]): Node[] {
  const byId = new Map<string, Node>(rows.map((r) => [r.id, { ...r, children: [] }]))
  const roots: Node[] = []
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const sort = (nodes: Node[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name))
    for (const n of nodes) sort(n.children)
  }
  sort(roots)
  return roots
}

export function FoldersPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [parentId, setParentId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ["folders"],
    queryFn: () => get<Page>("/folders?pageSize=200"),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["folders"] })
  const create = useMutation({
    mutationFn: (body: { name: string; parentId: string | null }) => post<Folder>("/folders", body),
    onSuccess: () => {
      invalidate()
      setOpen(false)
    },
  })
  const remove = useMutation({
    // force=true: the page offers one button, and deleting a branch is what
    // people mean when they click it on a folder that has children.
    mutationFn: (id: string) => del(`/folders/${id}?force=true`),
    onSuccess: invalidate,
  })

  const tree = useMemo(() => toTree(data?.rows ?? []), [data])

  const addUnder = (id: string | null) => {
    setParentId(id)
    setOpen(true)
  }

  return (
    <>
      <PageHeader
        title="Folders"
        description="A nested tree over your files."
        actions={
          <Button onClick={() => addUnder(null)}>
            <PlusIcon /> New folder
          </Button>
        }
      />

      {!isLoading && tree.length === 0 ? (
        <EmptyState
          icon={FolderIcon}
          title="No folders yet"
          description="Create a top-level folder, then nest as deep as you need."
          action={
            <Button onClick={() => addUnder(null)}>
              <PlusIcon /> New folder
            </Button>
          }
        />
      ) : (
        <ul className="text-sm">
          {tree.map((node) => (
            <Branch
              key={node.id}
              node={node}
              depth={0}
              onAdd={addUnder}
              onDelete={(id) => remove.mutate(id)}
            />
          ))}
        </ul>
      )}

      <NewFolderDialog
        open={open}
        parentId={parentId}
        onOpenChange={setOpen}
        pending={create.isPending}
        onSubmit={(name) => create.mutate({ name, parentId })}
      />
    </>
  )
}

function Branch({
  node,
  depth,
  onAdd,
  onDelete,
}: {
  node: Node
  depth: number
  onAdd: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = node.children.length > 0

  return (
    <li>
      <div
        className="hover:bg-muted/50 group flex items-center gap-2 rounded-md px-2 py-1.5"
        style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
      >
        <button
          type="button"
          className="text-muted-foreground disabled:opacity-0"
          aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
          disabled={!hasChildren}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <CaretDownIcon /> : <CaretRightIcon />}
        </button>
        {expanded && hasChildren ? <FolderOpenIcon /> : <FolderIcon />}
        <span className="flex-1 truncate">{node.name}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="opacity-0 group-hover:opacity-100"
          aria-label={`Add a folder inside ${node.name}`}
          onClick={() => onAdd(node.id)}
        >
          <PlusIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="opacity-0 group-hover:opacity-100"
          aria-label={`Delete ${node.name}`}
          onClick={() => onDelete(node.id)}
        >
          <TrashIcon />
        </Button>
      </div>

      {expanded && hasChildren ? (
        <ul>
          {node.children.map((child) => (
            <Branch
              key={child.id}
              node={child}
              depth={depth + 1}
              onAdd={onAdd}
              onDelete={onDelete}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function NewFolderDialog({
  open,
  parentId,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean
  parentId: string | null
  onOpenChange: (open: boolean) => void
  pending: boolean
  onSubmit: (name: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit(String(new FormData(e.currentTarget).get("name")))
          }}
        >
          <DialogHeader>
            <DialogTitle>{parentId ? "New subfolder" : "New folder"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required autoFocus />
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
