import React, { useEffect, useRef } from 'react'
import { effectiveType, fileKind, type FileEntry } from './fileModel'
import type { FileViewProps } from './FileGrid'
import { FileThumbnail, kindStyle } from './FileThumbnail'
import { formatDateTime, formatFileSize, formatRelativeTime } from './format'
import { Icon } from './icons'

export interface FileListProps extends Omit<FileViewProps, 'tileClassName'> {
  /** Paths are shown relative to this folder. */
  cwd: string
  onToggleAll: () => void
  onDownload: (entry: FileEntry) => void
  onDelete: (entry: FileEntry) => void
  rowClassName?: string
}

export function FileList({
  entries,
  selected,
  cwd,
  onActivate,
  onToggle,
  onToggleAll,
  onDownload,
  onDelete,
  className,
  rowClassName,
}: FileListProps) {
  const selectAllRef = useRef<HTMLInputElement>(null)
  const selectedHere = entries.filter((e) => selected.has(e.file.path)).length
  const allSelected = entries.length > 0 && selectedHere === entries.length

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedHere > 0 && !allSelected
  }, [selectedHere, allSelected])

  const prefix = cwd ? `${cwd}/` : ''

  return (
    <div className="seed-fm-list-wrap">
      <table className={['seed-fm-list', className].filter(Boolean).join(' ')}>
        <thead>
          <tr>
            <th style={{ width: 28 }}>
              <input
                ref={selectAllRef}
                type="checkbox"
                className="seed-fm-checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                aria-label="Select all"
              />
            </th>
            <th>Name</th>
            <th className="seed-fm-col-type">Type</th>
            <th className="seed-fm-num seed-fm-col-size">Size</th>
            <th className="seed-fm-col-modified">Modified</th>
            <th>
              <span className="seed-fm-visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => {
            const { file } = entry
            const isSelected = selected.has(file.path)
            return (
              <tr
                key={file.path}
                data-path={file.path}
                aria-selected={isSelected}
                className={['seed-fm-row', rowClassName].filter(Boolean).join(' ')}
                onClick={(e) => onActivate(entry, index, e)}
              >
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="seed-fm-checkbox"
                    checked={isSelected}
                    onChange={() => {}}
                    onClick={(e) => onToggle(entry, index, e.shiftKey)}
                    aria-label={`Select ${file.name}`}
                  />
                </td>
                <td>
                  <span className="seed-fm-namecell">
                    <FileThumbnail entry={entry} size="mini" />
                    <span>
                      <button
                        type="button"
                        className="seed-fm-row-name seed-fm-row-open"
                        onClick={(e) => {
                          e.stopPropagation()
                          onActivate(entry, index, e)
                        }}
                      >
                        {file.name}
                      </button>
                      {/* Search results can come from subfolders; show where. */}
                      {file.path.slice(prefix.length) !== file.name && (
                        <span className="seed-fm-row-path">{file.path.slice(prefix.length)}</span>
                      )}
                    </span>
                  </span>
                </td>
                <td className="seed-fm-col-type">
                  <span className="seed-fm-type" style={kindStyle(fileKind(file))}>
                    {effectiveType(file)}
                    {file.detectedType && <small>detected</small>}
                  </span>
                </td>
                <td className="seed-fm-num seed-fm-col-size" title={`${file.size.toLocaleString()} bytes`}>
                  {formatFileSize(entry.totalSize)}
                </td>
                <td className="seed-fm-when seed-fm-col-modified" title={formatDateTime(file.lastModified)}>
                  {formatRelativeTime(file.lastModified)}
                </td>
                <td className="seed-fm-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="seed-fm-btn seed-fm-btn--ghost seed-fm-btn--icon"
                    aria-label={`Download ${file.name}`}
                    title="Download"
                    onClick={() => onDownload(entry)}
                  >
                    <Icon name="download" size={15} />
                  </button>
                  <button
                    type="button"
                    className="seed-fm-btn seed-fm-btn--ghost seed-fm-btn--icon"
                    aria-label={`Delete ${file.name}`}
                    title="Delete"
                    onClick={() => onDelete(entry)}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
