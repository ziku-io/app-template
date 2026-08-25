import { useRef } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  DownloadSimpleIcon,
  PaperclipIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react"
import { Button, DataTable, EmptyState, PageHeader, toast, type DataTableColumn } from "@ziku/ui"

import { API_BASE, del, get, type Json } from "@/client/lib/api"

import type { FileRecord as FileRow } from "./schema"

type FileRecord = Json<FileRow>

const units = ["B", "KB", "MB", "GB"]
function humanSize(n: number) {
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function FilesPage() {
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ["files"],
    queryFn: () => get<{ rows: FileRecord[] }>("/files"),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["files"] })

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData()
      body.append("file", file)
      // Not the shared `post` helper: FormData sets its own content type.
      const res = await fetch(`${API_BASE}/files`, { method: "POST", body })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Upload failed")
      return res.json()
    },
    onSuccess: () => {
      invalidate()
      toast.success("Uploaded")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => del(`/files/${id}`),
    onSuccess: invalidate,
  })

  const columns: DataTableColumn<FileRecord>[] = [
    { key: "name", header: "File", icon: PaperclipIcon, className: "font-medium" },
    { key: "mimeType", header: "Type", facet: true },
    {
      key: "size",
      header: "Size",
      value: (r) => r.size,
      render: (r) => humanSize(r.size),
      className: "text-right tabular-nums",
    },
    {
      key: "createdAt",
      header: "Uploaded",
      render: (r) => new Date(r.createdAt).toLocaleDateString(),
    },
    {
      key: "actions",
      header: "",
      sortable: false,
      render: (r) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon-sm" asChild aria-label={`Download ${r.name}`}>
            <a href={`${API_BASE}/files/${r.id}/content`}>
              <DownloadSimpleIcon />
            </a>
          </Button>
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
      <PageHeader
        title="Files"
        description="Attachments for this workspace."
        actions={
          <Button onClick={() => input.current?.click()} disabled={upload.isPending}>
            <UploadSimpleIcon /> Upload
          </Button>
        }
      />
      <input
        ref={input}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) upload.mutate(file)
          e.target.value = ""
        }}
      />

      {!isLoading && rows.length === 0 ? (
        <EmptyState
          icon={PaperclipIcon}
          title="No files yet"
          description="Upload the first one to see it listed here."
          action={
            <Button onClick={() => input.current?.click()}>
              <UploadSimpleIcon /> Upload
            </Button>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={isLoading}
          rowId={(f) => f.id}
          viewKey="files"
          defaultSort={{ key: "createdAt", dir: "desc" }}
          searchPlaceholder="Search files…"
        />
      )}
    </>
  )
}
