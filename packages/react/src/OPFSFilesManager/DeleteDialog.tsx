import React, { useEffect, useRef, useState } from 'react'
import type { FileEntry } from './fileModel'
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

/** Delete confirmation, rendered as a native modal <dialog> (focus trap, Esc, top layer). */
export function DeleteDialog({
  entries,
  rootPath,
  warning,
  deleteActionFor,
  onCancel,
  onConfirm,
  className,
}: DeleteDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const [includeVariants, setIncludeVariants] = useState(true)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])

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
          onConfirm(includeVariants)
        }}
      >
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
          <button type="button" className="seed-fm-btn" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button
            type="submit"
            className={`seed-fm-btn ${action.destructive ? 'seed-fm-btn--danger' : 'seed-fm-btn--primary'}`}
          >
            {action.label ?? `Delete ${count} ${count === 1 ? 'file' : 'files'}`}
          </button>
        </div>
      </form>
    </dialog>
  )
}
