import React, { useEffect, useRef, useState } from 'react'
import type { OPFSFile } from '../useOPFSFiles'
import type { FileEntry, FolderSummary } from './fileModel'
import { formatFileSize, truncateMiddle } from './format'
import { Icon } from './icons'
import type { ResolvedDeleteAction } from './types'

const MAX_LISTED = 6

export interface DeleteDialogProps {
  entries: FileEntry[]
  /** Folder that listed paths are shown relative to. */
  rootPath: string
  warning: string | null
  /** Resolves the label and tone for the files the confirm button would remove. */
  deleteActionFor: (includeVariants: boolean) => ResolvedDeleteAction
  onCancel: () => void
  onConfirm: (includeVariants: boolean) => void
  className?: string
}

/** Native modal <dialog> (focus trap, Esc, top layer) wrapping a confirm form. */
function ConfirmDialog({
  className,
  onCancel,
  onSubmit,
  children,
}: {
  className?: string
  onCancel: () => void
  onSubmit: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) {
      dialog.showModal()
      // showModal() focuses the first control, which may be a checkbox or Download. Start on Cancel.
      dialog.querySelector<HTMLElement>('[data-initial-focus]')?.focus()
    }
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      className={['seed-fm-dialog', className].filter(Boolean).join(' ')}
      aria-labelledby="seed-fm-delete-title"
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the <dialog> element itself.
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit()
        }}
      >
        {children}
      </form>
    </dialog>
  )
}

/** Delete confirmation for one or more files. */
export function DeleteDialog({
  entries,
  rootPath,
  warning,
  deleteActionFor,
  onCancel,
  onConfirm,
  className,
}: DeleteDialogProps) {
  const [includeVariants, setIncludeVariants] = useState(true)

  const variants = entries.flatMap((e) => e.variants)
  const variantsSize = variants.reduce((n, v) => n + v.file.size, 0)
  const count = entries.length + (includeVariants ? variants.length : 0)
  const prefix = rootPath ? `${rootPath}/` : ''
  const action = deleteActionFor(includeVariants)
  const heading = action.label
    ? `${action.label}?`
    : entries.length === 1
      ? `Delete ${truncateMiddle(entries[0].file.name, 32)}?`
      : `Delete ${entries.length} files?`

  return (
    <ConfirmDialog className={className} onCancel={onCancel} onSubmit={() => onConfirm(includeVariants)}>
      <h3 id="seed-fm-delete-title">{heading}</h3>
      <p>
        This removes {entries.length === 1 ? 'it' : 'them'} from this browser’s private storage. Copies on Arweave or
        other devices aren’t affected. You can’t undo this.
      </p>
      <ul>
        {entries.slice(0, MAX_LISTED).map((e) => (
          <li key={e.file.path}>
            <code title={e.file.path}>{e.file.path.startsWith(prefix) ? e.file.path.slice(prefix.length) : e.file.path}</code>
            <span>{formatFileSize(e.file.size)}</span>
          </li>
        ))}
        {entries.length > MAX_LISTED && (
          <li>
            <span>and {entries.length - MAX_LISTED} more</span>
          </li>
        )}
      </ul>
      {variants.length > 0 && (
        <label>
          <input
            type="checkbox"
            className="seed-fm-checkbox"
            checked={includeVariants}
            onChange={(e) => setIncludeVariants(e.target.checked)}
          />
          Also delete {variants.length} resized {variants.length === 1 ? 'copy' : 'copies'} ({formatFileSize(variantsSize)})
        </label>
      )}
      {warning && (
        <div className="seed-fm-warning" role="alert">
          <Icon name="triangleAlert" size={16} />
          <span>{warning}</span>
        </div>
      )}
      <div className="seed-fm-dialog-actions">
        <button type="button" className="seed-fm-btn" onClick={onCancel} data-initial-focus>
          Cancel
        </button>
        <button
          type="submit"
          className={`seed-fm-btn ${action.destructive ? 'seed-fm-btn--danger' : 'seed-fm-btn--primary'}`}
        >
          {action.label ?? `Delete ${count} ${count === 1 ? 'file' : 'files'}`}
        </button>
      </div>
    </ConfirmDialog>
  )
}

export interface FolderDeleteDialogProps {
  folder: FolderSummary
  /** Every file under the folder that this manager shows, at any depth. */
  files: OPFSFile[]
  /** Files under the folder that `filter` hides. They're kept, so the folder stays. */
  hiddenCount: number
  warning: string | null
  action: ResolvedDeleteAction
  busy: boolean
  /** Saves the folder as a .zip. Resolves true once it's saved. */
  onDownload: () => Promise<boolean>
  onCancel: () => void
  onConfirm: () => void
  className?: string
}

/** Delete confirmation for a folder, with a chance to save a copy first. */
export function FolderDeleteDialog({
  folder,
  files,
  hiddenCount,
  warning,
  action,
  busy,
  onDownload,
  onCancel,
  onConfirm,
  className,
}: FolderDeleteDialogProps) {
  const [downloaded, setDownloaded] = useState(false)
  const size = files.reduce((n, f) => n + f.size, 0)
  const prefix = `${folder.path}/`
  const fileCount = `${files.length} ${files.length === 1 ? 'file' : 'files'}`
  // The folder card counts grouped resized copies as part of their original.
  const copies = files.length - folder.fileCount

  return (
    <ConfirmDialog className={className} onCancel={onCancel} onSubmit={onConfirm}>
      <h3 id="seed-fm-delete-title">
        {action.label ? `${action.label}?` : `Delete the “${truncateMiddle(folder.name, 32)}” folder?`}
      </h3>
      <p>
        This removes the folder and the {fileCount} in it ({formatFileSize(size)}
        {copies > 0 && `, including ${copies} resized ${copies === 1 ? 'copy' : 'copies'}`}) from this browser’s private
        storage. Copies on Arweave or other devices aren’t affected.
      </p>
      <div className="seed-fm-irreversible">
        <Icon name="triangleAlert" size={16} />
        <span>
          <strong>This can’t be undone.</strong> Once deleted, these files can’t be recovered from this browser.
        </span>
      </div>
      <ul>
        {files.slice(0, MAX_LISTED).map((f) => (
          <li key={f.path}>
            <code title={f.path}>{f.path.slice(prefix.length)}</code>
            <span>{formatFileSize(f.size)}</span>
          </li>
        ))}
        {files.length > MAX_LISTED && (
          <li>
            <span>and {files.length - MAX_LISTED} more</span>
          </li>
        )}
      </ul>
      <div className="seed-fm-keepcopy">
        <span>{downloaded ? 'Saved a copy to your computer.' : 'Want a copy first? Save the folder to your computer.'}</span>
        <button
          type="button"
          className="seed-fm-btn"
          disabled={busy}
          onClick={async () => {
            if (await onDownload()) setDownloaded(true)
          }}
        >
          <Icon name={downloaded ? 'check' : 'download'} size={15} /> {downloaded ? 'Download again' : 'Download .zip'}
        </button>
      </div>
      {hiddenCount > 0 && (
        <p>
          {hiddenCount} other {hiddenCount === 1 ? 'file' : 'files'} in this folder {hiddenCount === 1 ? 'is' : 'are'}{' '}
          hidden here and won’t be deleted, so the folder itself will stay.
        </p>
      )}
      {warning && (
        <div className="seed-fm-warning" role="alert">
          <Icon name="triangleAlert" size={16} />
          <span>{warning}</span>
        </div>
      )}
      <div className="seed-fm-dialog-actions">
        <button type="button" className="seed-fm-btn" onClick={onCancel} data-initial-focus>
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className={`seed-fm-btn ${action.destructive ? 'seed-fm-btn--danger' : 'seed-fm-btn--primary'}`}
        >
          {action.label ?? `Delete folder (${fileCount})`}
        </button>
      </div>
    </ConfirmDialog>
  )
}
