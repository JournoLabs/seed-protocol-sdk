import React, { useState, useRef, useEffect } from 'react'
import { useOPFSFiles, type OPFSFile } from './useOPFSFiles'

// Inline SVG icons to avoid external dependencies
const DownloadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 20, height: 20 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
)
const FolderIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 48, height: 48 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12a2.25 2.25 0 012.25-2.25h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
  </svg>
)
const DocumentIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 20, height: 20 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
  </svg>
)
const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 20, height: 20 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
  </svg>
)
const SpinnerIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    style={{ width: 32, height: 32 }}
    aria-hidden
  >
    <circle
      style={{ opacity: 0.25 }}
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    />
    <path
      style={{ opacity: 0.75 }}
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
)

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

async function getFileBlob(file: OPFSFile, root: FileSystemDirectoryHandle): Promise<Blob> {
  const pathParts = file.path.split('/').filter(Boolean)
  if (pathParts.length === 0) throw new Error('Invalid file path')

  let currentHandle: FileSystemDirectoryHandle = root
  for (let i = 0; i < pathParts.length - 1; i++) {
    currentHandle = await currentHandle.getDirectoryHandle(pathParts[i])
  }
  const fileName = pathParts[pathParts.length - 1]
  const fileHandle = await currentHandle.getFileHandle(fileName)
  const opfsFile = await fileHandle.getFile()
  return opfsFile
}

async function deleteFileAtPath(
  path: string,
  root: FileSystemDirectoryHandle
): Promise<void> {
  const pathParts = path.split('/').filter(Boolean)
  if (pathParts.length === 0) throw new Error('Invalid file path')

  let currentHandle: FileSystemDirectoryHandle = root
  for (let i = 0; i < pathParts.length - 1; i++) {
    currentHandle = await currentHandle.getDirectoryHandle(pathParts[i])
  }
  const fileName = pathParts[pathParts.length - 1]
  await currentHandle.removeEntry(fileName)
}

export type OPFSFilesManagerTheme = 'light' | 'dark'

export interface OPFSFilesManagerProps {
  /** Optional subdirectory to scan (e.g. 'app-files'). Default: root. */
  rootPath?: string
  /** Filter which files to include. */
  filter?: (file: OPFSFile) => boolean
  /** Called when a file is about to be deleted. Return false to cancel. */
  onBeforeDelete?: (file: OPFSFile) => boolean | Promise<boolean>
  /** Called after a file or files are deleted. Use for clearing app state (e.g. Seed DB). */
  onAfterDelete?: (paths: string[]) => void | Promise<void>
  /** Custom download handler (e.g. Electron). If not provided, uses browser blob download. */
  onDownload?: (file: OPFSFile, blob: Blob) => void | Promise<void>
  /** Title for the page. Default: "Files" */
  title?: string
  /** Description text. Default: OPFS description. */
  description?: string
  /** Visual theme. Default: "dark" */
  theme?: OPFSFilesManagerTheme
  /** Class for the container. */
  className?: string
}

const themeClasses = {
  light: {
    title: 'text-gray-900',
    description: 'text-gray-500',
    batchBar: 'bg-gray-100 border-gray-200',
    batchText: 'text-gray-900',
    clearButton: 'text-gray-500 hover:text-gray-900',
    loadingText: 'text-gray-500',
    errorBox: 'bg-red-50 border-red-200',
    errorTitle: 'text-red-800',
    errorText: 'text-red-700',
    emptyIcon: 'text-gray-400',
    emptyTitle: 'text-gray-900',
    emptyText: 'text-gray-500',
    tableHeader: 'bg-gray-100 text-gray-900',
    tableRow: 'bg-white',
    tableBorder: 'border-gray-200 divide-gray-200',
    tableCell: 'text-gray-900',
    tableCellMuted: 'text-gray-500',
    codeBlock: 'bg-gray-100 border-gray-200 text-gray-800',
    actionButton: 'text-gray-500 hover:text-gray-700',
    deleteButton: 'text-gray-500 hover:text-red-600',
  },
  dark: {
    title: 'text-white',
    description: 'text-gray-400',
    batchBar: 'bg-gray-800 border-gray-700',
    batchText: 'text-white',
    clearButton: 'text-gray-400 hover:text-white',
    loadingText: 'text-gray-400',
    errorBox: 'bg-red-900/50 border-red-800',
    errorTitle: 'text-red-200',
    errorText: 'text-red-300',
    emptyIcon: 'text-gray-500',
    emptyTitle: 'text-white',
    emptyText: 'text-gray-400',
    tableHeader: 'bg-gray-900 text-white',
    tableRow: 'bg-gray-900',
    tableBorder: 'border-gray-800 divide-gray-800',
    tableCell: 'text-white',
    tableCellMuted: 'text-gray-400',
    codeBlock: 'bg-gray-800 border-gray-700 text-gray-300',
    actionButton: 'text-gray-400 hover:text-indigo-400',
    deleteButton: 'text-gray-400 hover:text-red-500',
  },
} as const

const layoutStyles = {
  container: { padding: '2rem 0' } as React.CSSProperties,
  header: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    alignItems: 'center',
    gap: '1rem',
    marginBottom: '1rem',
  },
  title: { fontSize: '1.5rem', fontWeight: 600, margin: 0 },
  description: { fontSize: '0.875rem', margin: '0.5rem 0 0 0' },
  button:
    'rounded-md px-3 py-2 text-sm font-semibold border-0 cursor-pointer bg-indigo-600 text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600',
  buttonDanger:
    'rounded-md px-3 py-2 text-sm font-semibold border-0 cursor-pointer bg-red-600 text-white hover:bg-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600',
  table: 'min-w-full divide-y',
  tableHeader: 'py-3.5 pl-4 pr-3 text-left text-sm font-semibold sm:pl-6',
  tableCell: 'whitespace-nowrap py-4 pl-4 pr-3 text-sm sm:pl-6',
  errorBox: 'rounded-md border p-4 mt-4',
  emptyState: 'text-center py-12',
}

/**
 * A React component to browse, download, and delete files stored in OPFS.
 * Useful for debugging and managing Origin Private File System storage.
 *
 * @example
 * ```tsx
 * <OPFSFilesManager
 *   onAfterDelete={(paths) => {
 *     if (paths.some(isSeedDbPath)) {
 *       clearSeedDependentData()
 *       window.location.reload()
 *     }
 *   }}
 *   onDownload={async (file, blob) => {
 *     if (window.electron?.downloadFile) {
 *       await window.electron.downloadFile({ data: await blob.arrayBuffer(), filename: file.name })
 *     }
 *   }}
 * />
 * ```
 */
export function OPFSFilesManager({
  rootPath,
  filter,
  onBeforeDelete,
  onAfterDelete,
  onDownload,
  title = 'Files',
  description = 'Browse and download all files stored in the Origin Private File System (OPFS).',
  theme = 'dark',
  className,
}: OPFSFilesManagerProps) {
  const t = themeClasses[theme]
  const { files: rawFiles, isLoading, error, refetch } = useOPFSFiles({ rootPath })
  const files = filter ? rawFiles.filter(filter) : rawFiles
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null)

  const allSelected = files.length > 0 && selectedFiles.size === files.length
  const someSelected = selectedFiles.size > 0 && selectedFiles.size < files.length

  const toggleFileSelection = (filePath: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(filePath)) next.delete(filePath)
      else next.add(filePath)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelectedFiles(
      selectedFiles.size === files.length ? new Set() : new Set(files.map((f) => f.path))
    )
  }

  useEffect(() => {
    setSelectedFiles(new Set())
  }, [files.length])

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = someSelected
    }
  }, [someSelected])

  const downloadFile = async (file: OPFSFile, suppressAlert = false) => {
    try {
      const root = await navigator.storage.getDirectory()
      const blob = await getFileBlob(file, root)

      if (onDownload) {
        await onDownload(file, blob)
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = file.name
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
    } catch (err) {
      const msg = 'Failed to download file: ' + (err instanceof Error ? err.message : String(err))
      if (!suppressAlert) alert(msg)
      throw err
    }
  }

  const deleteFile = async (file: OPFSFile) => {
    if (onBeforeDelete) {
      const ok = await onBeforeDelete(file)
      if (!ok) return
    }
    if (!confirm(`Are you sure you want to delete "${file.name}"? This action cannot be undone.`)) {
      return
    }

    try {
      const root = await navigator.storage.getDirectory()
      await deleteFileAtPath(file.path, root)
      await refetch()
      await onAfterDelete?.([file.path])
    } catch (err) {
      alert('Failed to delete file: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const downloadAllSelected = async () => {
    if (selectedFiles.size === 0) return
    const selected = files.filter((f) => selectedFiles.has(f.path))
    const errors: string[] = []
    for (const file of selected) {
      try {
        await downloadFile(file, true)
        await new Promise((r) => setTimeout(r, 100))
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (errors.length > 0) {
      alert(`Some downloads failed:\n${errors.join('\n')}`)
    }
  }

  const deleteAllSelected = async () => {
    if (selectedFiles.size === 0) return
    const selected = files.filter((f) => selectedFiles.has(f.path))
    const names = selected.map((f) => f.name).join(', ')
    if (
      !confirm(
        `Are you sure you want to delete ${selectedFiles.size} file(s)?\n\nFiles: ${names}\n\nThis action cannot be undone.`
      )
    ) {
      return
    }

    const root = await navigator.storage.getDirectory()
    const deletedPaths: string[] = []
    const errors: string[] = []

    for (const file of selected) {
      if (onBeforeDelete) {
        const ok = await onBeforeDelete(file)
        if (!ok) continue
      }
      try {
        await deleteFileAtPath(file.path, root)
        deletedPaths.push(file.path)
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    setSelectedFiles(new Set())
    await refetch()
    if (deletedPaths.length > 0) await onAfterDelete?.(deletedPaths)
    if (errors.length > 0) {
      alert(`Some deletions failed:\n${errors.join('\n')}`)
    }
  }

  return (
    <div className={className} style={layoutStyles.container}>
      <style>{`@keyframes opfs-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div style={layoutStyles.header}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={layoutStyles.title} className={t.title}>
            {title}
          </h1>
          <p style={layoutStyles.description} className={t.description}>
            {description}
          </p>
        </div>
        <button type="button" onClick={refetch} className={layoutStyles.button}>
          Refresh
        </button>
      </div>

      {selectedFiles.size > 0 && (
        <div
          className={`mt-4 flex items-center justify-between rounded-lg border px-4 py-3 ${t.batchBar}`}
        >
          <span className={`text-sm font-medium ${t.batchText}`}>
            {selectedFiles.size} file{selectedFiles.size === 1 ? '' : 's'} selected
          </span>
          <div className="flex items-center gap-3">
            <button onClick={downloadAllSelected} className={layoutStyles.button}>
              <span className="inline-flex items-center gap-2">
                <DownloadIcon /> Download All
              </span>
            </button>
            <button onClick={deleteAllSelected} className={layoutStyles.buttonDanger}>
              <span className="inline-flex items-center gap-2">
                <TrashIcon /> Delete All
              </span>
            </button>
            <button
              onClick={() => setSelectedFiles(new Set())}
              className={`text-sm cursor-pointer bg-transparent border-0 ${t.clearButton}`}
            >
              Clear selection
            </button>
          </div>
        </div>
      )}

      <div className="mt-8">
        {isLoading ? (
          <div className="flex justify-center items-center py-12 gap-3">
            <span style={{ animation: 'opfs-spin 1s linear infinite' }}>
              <SpinnerIcon />
            </span>
            <span className={t.loadingText}>Loading files...</span>
          </div>
        ) : error ? (
          <div className={`${layoutStyles.errorBox} ${t.errorBox}`}>
            <h3 className={`m-0 text-sm font-medium ${t.errorTitle}`}>Error</h3>
            <div className={`mt-2 text-sm ${t.errorText}`}>{error}</div>
          </div>
        ) : files.length === 0 ? (
          <div className={layoutStyles.emptyState}>
            <span className={t.emptyIcon}>
              <FolderIcon />
            </span>
            <h3 className={`mt-2 text-sm font-semibold ${t.emptyTitle}`}>No files</h3>
            <p className={`mt-1 text-sm ${t.emptyText}`}>No files found in OPFS.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className={layoutStyles.table}>
              <thead>
                <tr className={t.tableBorder}>
                  <th className={`${layoutStyles.tableHeader} w-10 ${t.tableHeader}`}>
                    <input
                      ref={selectAllCheckboxRef}
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all"
                    />
                  </th>
                  <th className={`${layoutStyles.tableHeader} ${t.tableHeader}`}>Name</th>
                  <th className={`${layoutStyles.tableHeader} ${t.tableHeader}`}>Path</th>
                  <th className={`${layoutStyles.tableHeader} ${t.tableHeader}`}>Size</th>
                  <th className={`${layoutStyles.tableHeader} ${t.tableHeader}`}>Type</th>
                  <th className={`${layoutStyles.tableHeader} ${t.tableHeader}`}>Modified</th>
                  <th
                    className={`${layoutStyles.tableHeader} w-24 ${t.tableHeader}`}
                    aria-label="Actions"
                  />
                </tr>
              </thead>
              <tbody className={`divide-y ${t.tableBorder}`}>
                {files.map((file) => (
                  <tr key={file.path} className={t.tableRow}>
                    <td className={`${layoutStyles.tableCell} ${t.tableCell}`}>
                      <input
                        type="checkbox"
                        checked={selectedFiles.has(file.path)}
                        onChange={() => toggleFileSelection(file.path)}
                        aria-label={`Select ${file.name}`}
                      />
                    </td>
                    <td className={`${layoutStyles.tableCell} ${t.tableCell}`}>
                      <span className="flex items-center gap-2">
                        <DocumentIcon />
                        {file.name}
                      </span>
                    </td>
                    <td className={`${layoutStyles.tableCell} ${t.tableCellMuted}`}>
                      <code className={`text-xs px-2 py-1 rounded border ${t.codeBlock}`}>
                        {file.path}
                      </code>
                    </td>
                    <td className={`${layoutStyles.tableCell} ${t.tableCellMuted}`}>
                      {formatFileSize(file.size)}
                    </td>
                    <td className={`${layoutStyles.tableCell} ${t.tableCellMuted}`}>
                      {file.type}
                    </td>
                    <td className={`${layoutStyles.tableCell} ${t.tableCellMuted}`}>
                      {formatDate(file.lastModified)}
                    </td>
                    <td className={layoutStyles.tableCell}>
                      <div className="flex gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => downloadFile(file)}
                          title="Download"
                          className={`p-1.5 rounded cursor-pointer bg-transparent border-0 transition-colors ${t.actionButton}`}
                        >
                          <DownloadIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteFile(file)}
                          title="Delete"
                          className={`p-1.5 rounded cursor-pointer bg-transparent border-0 transition-colors ${t.deleteButton}`}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
