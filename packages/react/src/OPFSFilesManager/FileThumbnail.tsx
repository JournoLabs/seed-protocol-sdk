import React from 'react'
import { effectiveType, fileKind, formatLabel, type FileEntry, type FileKind } from './fileModel'
import { Icon, type IconName } from './icons'
import { useThumbnail } from './useThumbnail'

export const KIND_META: Record<FileKind, { icon: IconName; label: string; color: string }> = {
  image: { icon: 'image', label: 'Images', color: 'var(--seed-kind-image)' },
  database: { icon: 'database', label: 'Database', color: 'var(--seed-kind-database)' },
  json: { icon: 'fileJson', label: 'JSON', color: 'var(--seed-kind-json)' },
  html: { icon: 'fileCode', label: 'HTML', color: 'var(--seed-kind-html)' },
  text: { icon: 'fileText', label: 'Text', color: 'var(--seed-kind-text)' },
  other: { icon: 'file', label: 'Other', color: 'var(--seed-kind-other)' },
}

export const kindStyle = (kind: FileKind) =>
  ({ '--seed-kind': KIND_META[kind].color }) as React.CSSProperties

/**
 * Formats that can carry transparency get a checkerboard and are letterboxed instead of
 * cropped. Judged by the original: the SDK's WebP copies of a JPEG are still opaque.
 */
const mayBeTransparent = (entry: FileEntry) => /png|webp|gif|avif|svg/.test(effectiveType(entry.file))

export function FileThumbnail({
  entry,
  size,
  children,
}: {
  entry: FileEntry
  size: 'tile' | 'mini'
  /** Overlays (checkbox, badges) rendered inside the frame. */
  children?: React.ReactNode
}) {
  const kind = fileKind(entry.file)
  const { ref, url, status, markError } = useThumbnail(entry)
  const failed = kind === 'image' && status === 'error'
  const showImage = kind === 'image' && url && !failed

  const className = [
    size === 'tile' ? 'seed-fm-thumb' : 'seed-fm-mini',
    showImage && mayBeTransparent(entry) ? 'seed-fm-thumb--checker' : '',
    kind === 'image' && status === 'loading' ? 'seed-fm-skeleton' : '',
  ]
    .filter(Boolean)
    .join(' ')

  let content: React.ReactNode
  if (showImage) {
    content = <img src={url} alt="" decoding="async" draggable={false} onError={markError} />
  } else if (size === 'mini') {
    content = <Icon name={failed ? 'imageOff' : KIND_META[kind].icon} size={16} />
  } else if (kind === 'image' && !failed) {
    content = null
  } else {
    content = (
      <span className="seed-fm-kind">
        <Icon name={failed ? 'imageOff' : KIND_META[kind].icon} size={28} strokeWidth={1.6} />
        {failed ? (
          <span className="seed-fm-kind-error">Can’t decode image</span>
        ) : (
          <span className="seed-fm-ext">{formatLabel(entry.file)}</span>
        )}
      </span>
    )
  }

  return (
    <span ref={ref} className={className} style={kindStyle(kind)}>
      {content}
      {children}
    </span>
  )
}
