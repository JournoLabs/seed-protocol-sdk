import React from 'react'
import type { FileEntry } from './fileModel'
import { FileThumbnail } from './FileThumbnail'
import { formatDateTime, formatFileSize, formatRelativeTime, truncateMiddle } from './format'
import { Icon } from './icons'

export interface FileViewProps {
  entries: FileEntry[]
  selected: ReadonlySet<string>
  /** Click or Enter on an item. */
  onActivate: (entry: FileEntry, index: number, event: React.MouseEvent | React.KeyboardEvent) => void
  /** Checkbox, Space, or Shift-click. `range` extends from the last toggled item. */
  onToggle: (entry: FileEntry, index: number, range: boolean) => void
  tileClassName?: string
  className?: string
}

export function FileGrid({ entries, selected, onActivate, onToggle, className, tileClassName }: FileViewProps) {
  return (
    <ul
      className={['seed-fm-grid', className].filter(Boolean).join(' ')}
      role="listbox"
      aria-label="Files"
      aria-multiselectable="true"
    >
      {entries.map((entry, index) => {
        const { file, variants } = entry
        const isSelected = selected.has(file.path)
        return (
          <li
            key={file.path}
            role="option"
            tabIndex={0}
            aria-selected={isSelected}
            aria-label={file.name}
            title={file.path}
            data-path={file.path}
            className={['seed-fm-tile', tileClassName].filter(Boolean).join(' ')}
            onClick={(e) => onActivate(entry, index, e)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return
              if (e.key === 'Enter') {
                e.preventDefault()
                onActivate(entry, index, e)
              } else if (e.key === ' ') {
                e.preventDefault()
                onToggle(entry, index, e.shiftKey)
              }
            }}
          >
            <FileThumbnail entry={entry} size="tile">
              <button
                type="button"
                className="seed-fm-check"
                tabIndex={-1}
                aria-label={`${isSelected ? 'Deselect' : 'Select'} ${file.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggle(entry, index, e.shiftKey)
                }}
              >
                {isSelected && <Icon name="check" size={14} strokeWidth={3} />}
              </button>
              {variants.length > 0 && (
                <span className="seed-fm-badge" title="Resized copies are grouped with this image">
                  <Icon name="layers" size={11} strokeWidth={2.2} />
                  {variants.length} {variants.length === 1 ? 'size' : 'sizes'}
                </span>
              )}
            </FileThumbnail>
            <span className="seed-fm-tile-meta">
              <span className="seed-fm-tile-name">{truncateMiddle(file.name, 24)}</span>
              <span className="seed-fm-tile-sub">
                {formatFileSize(file.size)} ·{' '}
                <time dateTime={new Date(file.lastModified).toISOString()} title={formatDateTime(file.lastModified)}>
                  {formatRelativeTime(file.lastModified)}
                </time>
              </span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
