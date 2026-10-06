import React, { useEffect, useRef, useState } from 'react'
import { getOPFSFile } from '../opfsPaths'
import { effectiveType, fileKind, type FileEntry } from './fileModel'
import { KIND_META, kindStyle } from './FileThumbnail'
import { formatDateTime, formatFileSize, formatRelativeTime } from './format'
import { Icon } from './icons'

/** Text files larger than this aren't previewed. */
const MAX_TEXT_PREVIEW_FILE = 1024 * 1024
/** Only this many bytes of a text file are shown. */
const TEXT_PREVIEW_BYTES = 32 * 1024

type Preview =
  | { kind: 'loading' }
  | { kind: 'image'; url: string }
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'none'; message: string }

function usePreview(entry: FileEntry): Preview {
  const [preview, setPreview] = useState<Preview>({ kind: 'loading' })
  const { path, lastModified } = entry.file
  const kind = fileKind(entry.file)
  const size = entry.file.size

  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    setPreview({ kind: 'loading' })

    const load = async (): Promise<Preview> => {
      if (kind === 'image') {
        url = URL.createObjectURL(await getOPFSFile(path))
        return { kind: 'image', url }
      }
      if (kind === 'json' || kind === 'html' || kind === 'text') {
        if (size > MAX_TEXT_PREVIEW_FILE) return { kind: 'none', message: 'This file is too large to preview.' }
        const file = await getOPFSFile(path)
        const truncated = file.size > TEXT_PREVIEW_BYTES
        let text = await file.slice(0, TEXT_PREVIEW_BYTES).text()
        if (kind === 'json' && !truncated) {
          try {
            text = JSON.stringify(JSON.parse(text), null, 2)
          } catch {
            // Show the raw text when it isn't valid JSON.
          }
        }
        return { kind: 'text', text, truncated }
      }
      if (kind === 'database') {
        return { kind: 'none', message: 'SQLite database. Download it to open it in a database tool.' }
      }
      return { kind: 'none', message: 'No preview for this file type.' }
    }

    load().then(
      (p) => {
        if (!cancelled) setPreview(p)
      },
      (err) => {
        if (!cancelled) setPreview({ kind: 'none', message: `Couldn’t read the file: ${err instanceof Error ? err.message : String(err)}` })
      },
    )
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [path, lastModified, size, kind])

  return preview
}

export interface PreviewPanelProps {
  entry: FileEntry
  onClose: () => void
  onPrevious: (() => void) | null
  onNext: (() => void) | null
  onDownload: () => void
  onDelete: () => void
  onCopyPath: () => void
  className?: string
}

export function PreviewPanel({
  entry,
  onClose,
  onPrevious,
  onNext,
  onDownload,
  onDelete,
  onCopyPath,
  className,
}: PreviewPanelProps) {
  const { file, variants } = entry
  const kind = fileKind(file)
  const preview = usePreview(entry)
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)
  const [imageFailed, setImageFailed] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setDimensions(null)
    setImageFailed(false)
  }, [file.path])

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  const headingId = `seed-fm-panel-${encodeURIComponent(file.path)}`
  const variantsSize = variants.reduce((n, v) => n + v.file.size, 0)

  let previewContent: React.ReactNode
  if (preview.kind === 'image' && !imageFailed) {
    previewContent = (
      <img
        src={preview.url}
        alt={`Preview of ${file.name}`}
        onLoad={(e) => setDimensions({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
        onError={() => setImageFailed(true)}
      />
    )
  } else if (preview.kind === 'text') {
    previewContent = (
      <pre>
        {preview.text}
        {preview.truncated && '\n…'}
      </pre>
    )
  } else if (preview.kind === 'loading') {
    previewContent = null
  } else {
    const message =
      preview.kind === 'none'
        ? preview.message
        : 'The browser can’t decode this image. The file may be corrupt or not an image.'
    previewContent = (
      <span className="seed-fm-preview-note">
        <Icon name={imageFailed ? 'imageOff' : KIND_META[kind].icon} size={32} strokeWidth={1.5} />
        {message}
      </span>
    )
  }

  const checker = preview.kind === 'image' && !imageFailed && /png|webp|gif|avif|svg/.test(effectiveType(file))

  return (
    <aside
      className={['seed-fm-panel', className].filter(Boolean).join(' ')}
      role="dialog"
      aria-modal="false"
      aria-labelledby={headingId}
    >
      <div className="seed-fm-panel-head">
        <h3 id={headingId} title={file.name}>
          {file.name}
        </h3>
        <button
          type="button"
          className="seed-fm-btn seed-fm-btn--ghost seed-fm-btn--icon"
          aria-label="Previous file"
          disabled={!onPrevious}
          onClick={onPrevious ?? undefined}
        >
          <Icon name="chevronLeft" />
        </button>
        <button
          type="button"
          className="seed-fm-btn seed-fm-btn--ghost seed-fm-btn--icon"
          aria-label="Next file"
          disabled={!onNext}
          onClick={onNext ?? undefined}
        >
          <Icon name="chevronRight" />
        </button>
        <button
          ref={closeRef}
          type="button"
          className="seed-fm-btn seed-fm-btn--ghost seed-fm-btn--icon"
          aria-label="Close details"
          onClick={onClose}
        >
          <Icon name="x" />
        </button>
      </div>

      <div className="seed-fm-panel-body">
        <div
          className={['seed-fm-preview', checker ? 'seed-fm-thumb--checker' : '', preview.kind === 'loading' ? 'seed-fm-skeleton' : '']
            .filter(Boolean)
            .join(' ')}
          style={kindStyle(kind)}
        >
          {previewContent}
        </div>

        <dl className="seed-fm-details">
          <dt>Path</dt>
          <dd>
            <span className="seed-fm-path">
              <code>{file.path}</code>
              <button
                type="button"
                className="seed-fm-btn seed-fm-btn--ghost seed-fm-btn--icon"
                aria-label="Copy path"
                title="Copy path"
                onClick={onCopyPath}
              >
                <Icon name="copy" size={13} />
              </button>
            </span>
          </dd>
          <dt>Size</dt>
          <dd>
            {formatFileSize(file.size)} <small>{file.size.toLocaleString()} bytes</small>
          </dd>
          <dt>Type</dt>
          <dd>
            {effectiveType(file)}
            {file.detectedType && <small> from file contents. File.type is “{file.type}”</small>}
          </dd>
          {dimensions && (
            <>
              <dt>Dimensions</dt>
              <dd>
                {dimensions.width.toLocaleString()} × {dimensions.height.toLocaleString()} px
              </dd>
            </>
          )}
          <dt>Modified</dt>
          <dd>
            {formatDateTime(file.lastModified)} <small>{formatRelativeTime(file.lastModified)}</small>
          </dd>
        </dl>

        {variants.length > 0 && (
          <div>
            <div className="seed-fm-section-label">Resized copies · {formatFileSize(variantsSize)}</div>
            <ul className="seed-fm-variants">
              {variants.map((v) => (
                <li key={v.file.path} title={v.file.path}>
                  <span>{v.width}w · webp</span>
                  <span>{formatFileSize(v.file.size)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="seed-fm-panel-foot">
        <button type="button" className="seed-fm-btn seed-fm-btn--primary" onClick={onDownload}>
          <Icon name="download" size={15} /> Download
        </button>
        <button type="button" className="seed-fm-btn seed-fm-btn--danger-text" onClick={onDelete}>
          <Icon name="trash" size={15} /> Delete
        </button>
      </div>
    </aside>
  )
}
