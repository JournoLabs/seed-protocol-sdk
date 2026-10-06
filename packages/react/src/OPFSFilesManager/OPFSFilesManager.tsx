import React, { useCallback, useEffect, useInsertionEffect, useMemo, useRef, useState } from 'react'
import { useOPFSFiles, type OPFSFile } from '../useOPFSFiles'
import { deleteOPFSEntry, getOPFSFile, isOPFSSupported } from '../opfsPaths'
import { DeleteDialog } from './DeleteDialog'
import { FileGrid } from './FileGrid'
import { FileList } from './FileList'
import { KIND_META } from './FileThumbnail'
import {
  buildEntries,
  defaultDeleteWarning,
  fileKind,
  listDirectory,
  parseImageVariant,
  sizeByKind,
  type FileEntry,
  type FileKind,
  type SortKey,
} from './fileModel'
import { formatFileSize } from './format'
import { Icon } from './icons'
import { PreviewPanel } from './PreviewPanel'
import { ensureStylesInjected } from './styles'
import type {
  OPFSFilesManagerNotice,
  OPFSFilesManagerNotifyTone,
  OPFSFilesManagerProps,
  OPFSFilesManagerSlot,
  OPFSFilesManagerView,
  ResolvedDeleteAction,
} from './types'
import { useStorageEstimate, type StorageEstimate } from './useStorageEstimate'
import { createZip } from './zip'

const DEFAULT_DESCRIPTION = 'Everything this app stores in the browser’s private file system (OPFS).'
const TOAST_MS = 4000

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const normalizeDir = (path?: string) => (path ?? '').split('/').filter(Boolean).join('/')

function triggerBrowserDownload(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

interface Toast {
  id: number
  message: string
  tone: OPFSFilesManagerNotifyTone
}

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])
  const showToast = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, message, tone }])
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setToasts((t) => t.filter((x) => x.id !== id))
    }, TOAST_MS)
    timers.current.add(timer)
  }, [])
  return { toasts, showToast }
}

const METER_KINDS: FileKind[] = ['image', 'database', 'json', 'html', 'text', 'other']

function UsageMeter({ files, estimate }: { files: OPFSFile[]; estimate: StorageEstimate | null }) {
  const byKind = sizeByKind(files)
  const filesTotal = files.reduce((n, f) => n + f.size, 0)
  // estimate() covers the whole origin and is padded, so it can differ from the sum of file sizes.
  const otherSiteData = estimate ? Math.max(0, estimate.usage - filesTotal) : 0
  const total = filesTotal + otherSiteData
  const segments = [
    ...METER_KINDS.filter((k) => byKind[k] > 0).map((k) => ({
      label: KIND_META[k].label,
      size: byKind[k],
      color: KIND_META[k].color,
    })),
    ...(otherSiteData > 0
      ? [{ label: 'Other site data', size: otherSiteData, color: 'var(--seed-border-strong)' }]
      : []),
  ]

  return (
    <div className="seed-fm-usage" title="From navigator.storage.estimate(). Browsers round these numbers.">
      <div className="seed-fm-usage-row">
        <span>
          <strong>{formatFileSize(estimate ? estimate.usage : filesTotal)}</strong>{' '}
          {estimate ? 'used by this site' : `in ${plural(files.length, 'file')}`}
        </span>
        {estimate && <span>{formatFileSize(estimate.quota)} available</span>}
      </div>
      {total > 0 && (
        <>
          <div className="seed-fm-meter" role="img" aria-label="Storage used, by file type">
            {segments.map((s) => (
              <span key={s.label} style={{ width: `${(s.size / total) * 100}%`, background: s.color }} />
            ))}
          </div>
          <ul className="seed-fm-legend">
            {segments.map((s) => (
              <li key={s.label} style={{ '--seed-swatch': s.color } as React.CSSProperties}>
                {s.label} {formatFileSize(s.size)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function StateMessage({
  icon,
  title,
  children,
  tone,
  action,
}: {
  icon: React.ComponentProps<typeof Icon>['name']
  title: string
  children: React.ReactNode
  tone?: 'error'
  action?: React.ReactNode
}) {
  return (
    <div className={`seed-fm-state${tone === 'error' ? ' seed-fm-state--error' : ''}`} role={tone === 'error' ? 'alert' : undefined}>
      <span className="seed-fm-state-icon">
        <Icon name={icon} size={22} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  )
}

/**
 * Browse, preview, download, and delete files stored in OPFS (the Origin Private File
 * System). Useful for debugging and for letting people manage what an app stores locally.
 *
 * @example
 * ```tsx
 * <OPFSFilesManager
 *   rootPath="app-files"
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
  description = DEFAULT_DESCRIPTION,
  headingLevel = 2,
  theme = 'system',
  className,
  classNames = {},
  defaultView,
  groupImageVariants = true,
  deleteWarning = defaultDeleteWarning,
  confirmDelete,
  deleteAction,
  onNotify,
}: OPFSFilesManagerProps) {
  useInsertionEffect(() => {
    if (theme !== 'none') ensureStylesInjected()
  }, [theme])

  const rootDir = normalizeDir(rootPath)
  const rootLabel = rootDir ? rootDir.split('/').pop()! : 'OPFS'
  const cn = (slot: OPFSFilesManagerSlot, base: string) => [base, classNames[slot]].filter(Boolean).join(' ')

  const { files: rawFiles, isLoading, hasLoaded, error, errorName, refetch } = useOPFSFiles({ rootPath })
  const files = useMemo(() => (filter ? rawFiles.filter(filter) : rawFiles), [rawFiles, filter])
  const estimate = useStorageEstimate(rawFiles)

  const [grouped, setGrouped] = useState(groupImageVariants)
  useEffect(() => setGrouped(groupImageVariants), [groupImageVariants])
  const entries = useMemo(() => buildEntries(files, grouped), [files, grouped])

  const [cwd, setCwd] = useState(rootDir)
  useEffect(() => setCwd(rootDir), [rootDir])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('name')
  const [viewChoice, setViewChoice] = useState<OPFSFilesManagerView | undefined>(defaultView)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const anchorRef = useRef<number | null>(null)
  const [panelPath, setPanelPath] = useState<string | null>(null)
  const panelOpenerRef = useRef<HTMLElement | null>(null)
  const [pendingDelete, setPendingDelete] = useState<FileEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const { toasts, showToast } = useToasts()
  const notify = (message: string, tone: OPFSFilesManagerNotifyTone, notice: OPFSFilesManagerNotice) => {
    if (onNotify) onNotify(message, tone, notice)
    else showToast(message, tone)
  }

  const listing = useMemo(() => listDirectory(entries, cwd, { query, sort }), [entries, cwd, query, sort])
  const visible = listing.entries
  const imageShare = visible.length ? visible.filter((e) => fileKind(e.file) === 'image').length / visible.length : 0
  const view: OPFSFilesManagerView = viewChoice ?? (imageShare >= 0.5 ? 'grid' : 'list')

  const entriesByPath = useMemo(() => new Map(entries.map((e) => [e.file.path, e])), [entries])
  const selectedEntries = useMemo(
    () => [...selected].map((p) => entriesByPath.get(p)).filter((e): e is FileEntry => !!e),
    [selected, entriesByPath],
  )
  const panelEntry = panelPath ? entriesByPath.get(panelPath) ?? null : null
  const panelIndex = panelEntry ? visible.indexOf(panelEntry) : -1

  // Keep the selection across refreshes, minus anything that no longer exists.
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((p) => entriesByPath.has(p)))
      return next.size === prev.size ? prev : next
    })
  }, [entriesByPath])

  const navigate = (dir: string) => {
    setCwd(dir)
    setQuery('')
    setSelected(new Set())
    anchorRef.current = null
    setPanelPath(null)
  }

  const toggle = (entry: FileEntry, index: number, range: boolean) => {
    const anchor = anchorRef.current
    setSelected((prev) => {
      const next = new Set(prev)
      if (range && anchor != null) {
        const [from, to] = anchor < index ? [anchor, index] : [index, anchor]
        for (const e of visible.slice(from, to + 1)) next.add(e.file.path)
      } else if (next.has(entry.file.path)) {
        next.delete(entry.file.path)
      } else {
        next.add(entry.file.path)
      }
      return next
    })
    if (!range || anchor == null) anchorRef.current = index
  }

  const openPanel = (path: string) => {
    if (!panelPath) panelOpenerRef.current = document.activeElement as HTMLElement | null
    setPanelPath(path)
  }

  const closePanel = () => {
    setPanelPath(null)
    panelOpenerRef.current?.focus?.()
    panelOpenerRef.current = null
  }

  const activate = (entry: FileEntry, index: number, event: React.MouseEvent | React.KeyboardEvent) => {
    const modified = event.shiftKey || event.metaKey || event.ctrlKey
    if (selected.size > 0 || modified) toggle(entry, index, event.shiftKey)
    else openPanel(entry.file.path)
  }

  const toggleAllVisible = () => {
    const allSelected = visible.every((e) => selected.has(e.file.path))
    setSelected((prev) => {
      const next = new Set(prev)
      for (const e of visible) {
        if (allSelected) next.delete(e.file.path)
        else next.add(e.file.path)
      }
      return next
    })
  }

  const relativeToRoot = (path: string) => (rootDir && path.startsWith(`${rootDir}/`) ? path.slice(rootDir.length + 1) : path)

  const saveBlob = async (file: OPFSFile, blob: Blob) => {
    if (onDownload) await onDownload(file, blob)
    else triggerBrowserDownload(file.name, blob)
  }

  const download = async (list: FileEntry[]) => {
    if (list.length === 0) return
    setBusy(true)
    try {
      if (list.length === 1) {
        const { file } = list[0]
        await saveBlob(file, await getOPFSFile(file.path))
        return
      }
      const inputs = await Promise.all(
        list.map(async ({ file }) => ({
          name: relativeToRoot(file.path),
          data: await getOPFSFile(file.path),
          lastModified: file.lastModified,
        })),
      )
      const zip = await createZip(inputs)
      const name = `${rootLabel}-${new Date().toISOString().slice(0, 10)}.zip`
      await saveBlob({ name, path: name, size: zip.size, type: 'application/zip', lastModified: Date.now() }, zip)
      notify(`Saved ${name} with ${plural(list.length, 'file')}`, 'success', {
        kind: 'download',
        paths: list.map((e) => e.file.path),
        fileName: name,
      })
    } catch (err) {
      notify(`Couldn’t download: ${errorMessage(err)}`, 'error', {
        kind: 'download',
        paths: list.map((e) => e.file.path),
        error: errorMessage(err),
      })
    } finally {
      setBusy(false)
    }
  }

  const filesToDelete = (list: FileEntry[], includeVariants: boolean) =>
    list.flatMap((e) => [e.file, ...(includeVariants ? e.variants.map((v) => v.file) : [])])

  const resolveDeleteAction = (targets: OPFSFile[]): ResolvedDeleteAction => {
    const action = deleteAction?.(targets)
    return { label: action?.label, destructive: action?.destructive !== false }
  }
  const deleteActionFor = (list: FileEntry[]) => resolveDeleteAction(filesToDelete(list, true))

  const performDelete = async (targets: OPFSFile[]) => {
    setBusy(true)
    const deleted: string[] = []
    const failed: { path: string; error: string }[] = []
    const skipped: string[] = []
    try {
      const root = await navigator.storage.getDirectory()
      for (const file of targets) {
        if (onBeforeDelete && !(await onBeforeDelete(file))) {
          skipped.push(file.path)
          continue
        }
        try {
          await deleteOPFSEntry(file.path, root)
          deleted.push(file.path)
        } catch (err) {
          failed.push({ path: file.path, error: errorMessage(err) })
        }
      }
    } catch (err) {
      failed.push({ path: '', error: errorMessage(err) })
    }

    setSelected((prev) => {
      const next = new Set(prev)
      deleted.forEach((p) => next.delete(p))
      return next
    })
    if (panelPath && deleted.includes(panelPath)) setPanelPath(null)
    await refetch()
    setBusy(false)

    const parts = [deleted.length > 0 ? `Deleted ${plural(deleted.length, 'file')}` : 'Nothing deleted']
    if (skipped.length) parts.push(`${skipped.length} kept by onBeforeDelete`)
    if (failed.length) {
      const reasons = failed.map((f) => (f.path ? `${f.path.split('/').pop()}: ${f.error}` : f.error))
      parts.push(`${failed.length} failed (${reasons.join('; ')})`)
    }
    notify(parts.join('. '), failed.length ? 'error' : 'success', { kind: 'delete', deleted, skipped, failed })

    if (deleted.length > 0) await onAfterDelete?.(deleted)
  }

  const requestDelete = async (list: FileEntry[]) => {
    if (list.length === 0) return
    if (!confirmDelete) {
      setPendingDelete(list)
      return
    }
    const targets = filesToDelete(list, true)
    if (await confirmDelete(targets)) await performDelete(targets)
  }

  const copyPath = (path: string) => {
    const done = () => notify('Path copied', 'success', { kind: 'copy-path', path })
    const fail = (err?: unknown) =>
      notify('Couldn’t copy. Select the path text instead.', 'error', {
        kind: 'copy-path',
        path,
        error: err === undefined ? 'Clipboard unavailable' : errorMessage(err),
      })
    try {
      navigator.clipboard.writeText(path).then(done, fail)
    } catch (err) {
      fail(err)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (pendingDelete) return
    const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement
    if (e.key === 'Escape') {
      if (panelPath) closePanel()
      else if (selected.size > 0) setSelected(new Set())
      else return
      e.preventDefault()
      return
    }
    if (panelEntry && !inField && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const next = visible[panelIndex + (e.key === 'ArrowRight' ? 1 : -1)]
      if (next) setPanelPath(next.file.path)
      e.preventDefault()
    }
  }

  const hasVariants = useMemo(() => files.some((f) => parseImageVariant(f.path)), [files])
  const inImagesFolder = /(^|\/)images(\/\d+)?$/.test(cwd)
  const crumbs = [
    { label: rootLabel, path: rootDir },
    ...(cwd.length > rootDir.length ? cwd.slice(rootDir ? rootDir.length + 1 : 0).split('/') : []).map((name, i, all) => ({
      label: name,
      path: [rootDir, ...all.slice(0, i + 1)].filter(Boolean).join('/'),
    })),
  ]
  const Heading = `h${headingLevel}` as 'h2'
  const selectedSize = selectedEntries.reduce((n, e) => n + e.file.size, 0)

  let body: React.ReactNode
  if (!isOPFSSupported()) {
    body = (
      <StateMessage icon="triangleAlert" tone="error" title="This browser doesn’t support private file storage">
        OPFS isn’t available here. Some private browsing windows and older browsers turn it off. Try a current version of
        Chrome, Edge, Firefox, or Safari in a normal window.
      </StateMessage>
    )
  } else if (error) {
    const retry = (
      <button type="button" className="seed-fm-btn" onClick={() => refetch()}>
        <Icon name="refresh" size={15} /> Try again
      </button>
    )
    body =
      errorName === 'NotFoundError' && rootDir ? (
        <StateMessage icon="triangleAlert" tone="error" title={`Can’t open ${rootDir}`} action={retry}>
          The folder <code>{rootDir}</code> doesn’t exist in this browser’s private storage yet. Check the{' '}
          <code>rootPath</code> prop, or open the app once so the SDK creates it.
        </StateMessage>
      ) : (
        <StateMessage icon="triangleAlert" tone="error" title="Can’t read private storage" action={retry}>
          {error}
        </StateMessage>
      )
  } else if (!hasLoaded) {
    body = (
      <ul className={cn('grid', 'seed-fm-grid')} aria-busy="true" aria-label="Loading files">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i} className="seed-fm-tile">
            <span className="seed-fm-thumb seed-fm-skeleton" />
          </li>
        ))}
      </ul>
    )
  } else if (entries.length === 0) {
    body = (
      <StateMessage icon="folderOpen" title={`No files in ${rootLabel} yet`}>
        Files show up here when the app saves images, JSON, or HTML to this browser’s private storage, for example after
        you add an image to a post or sync content from Arweave.
      </StateMessage>
    )
  } else if (listing.folders.length === 0 && visible.length === 0) {
    body = query ? (
      <StateMessage
        icon="search"
        title={`No matches for “${query}”`}
        action={
          <button type="button" className="seed-fm-btn" onClick={() => setQuery('')}>
            Clear search
          </button>
        }
      >
        Search covers file names and paths in {crumbs[crumbs.length - 1].label} and every folder inside it.
      </StateMessage>
    ) : (
      <StateMessage icon="folderOpen" title="This folder is empty">
        Everything in it has been deleted or filtered out.
      </StateMessage>
    )
  } else {
    body = (
      <>
        {listing.folders.length > 0 && (
          <>
            <div className="seed-fm-section-label">Folders</div>
            <ul className="seed-fm-folders">
              {listing.folders.map((folder) => (
                <li key={folder.path}>
                  <button type="button" className={cn('folder', 'seed-fm-folder')} onClick={() => navigate(folder.path)}>
                    <Icon name="folder" size={20} strokeWidth={1.75} />
                    <span>
                      <span className="seed-fm-folder-name">{folder.name}</span>
                      <span className="seed-fm-folder-meta">
                        {plural(folder.fileCount, 'file')} · {formatFileSize(folder.size)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {visible.length > 0 && (
          <>
            <div className="seed-fm-section-label">{query ? plural(visible.length, 'result') : 'Files'}</div>
            {view === 'grid' ? (
              <FileGrid
                entries={visible}
                selected={selected}
                onActivate={activate}
                onToggle={toggle}
                className={classNames.grid}
                tileClassName={classNames.tile}
              />
            ) : (
              <FileList
                entries={visible}
                selected={selected}
                cwd={cwd}
                onActivate={activate}
                onToggle={toggle}
                onToggleAll={toggleAllVisible}
                onDownload={(e) => download([e])}
                onDelete={(e) => requestDelete([e])}
                deleteActionFor={(e) => deleteActionFor([e])}
                className={classNames.list}
                rowClassName={classNames.row}
              />
            )}
          </>
        )}
      </>
    )
  }

  const pendingFiles = pendingDelete ? filesToDelete(pendingDelete, true) : []
  const batchDeleteAction = selected.size > 0 ? deleteActionFor(selectedEntries) : null

  return (
    <div
      className={[cn('root', 'seed-fm'), className].filter(Boolean).join(' ')}
      data-seed-theme={theme === 'none' ? undefined : theme}
      data-selecting={selected.size > 0 || undefined}
      onKeyDown={onKeyDown}
    >
      <div className="seed-fm-frame">
        <header className={cn('header', 'seed-fm-header')}>
          <div className="seed-fm-titles">
            <Heading className="seed-fm-title">{title}</Heading>
            {description && <p className="seed-fm-description">{description}</p>}
          </div>
          {hasLoaded && !error && <UsageMeter files={files} estimate={estimate} />}
          <button
            type="button"
            className="seed-fm-btn seed-fm-btn--icon"
            onClick={() => refetch()}
            aria-label="Refresh"
            title="Refresh"
            data-busy={isLoading && hasLoaded}
          >
            <Icon name="refresh" size={15} />
          </button>
        </header>

        {hasLoaded && !error && entries.length > 0 && (
          <div className={cn('toolbar', 'seed-fm-toolbar')}>
            <nav aria-label="Folder">
              <ol className="seed-fm-crumbs">
                {crumbs.map((c, i) => (
                  <li key={c.path || '/'}>
                    {i > 0 && <Icon name="chevronRight" size={14} />}
                    <button
                      type="button"
                      onClick={() => navigate(c.path)}
                      aria-current={i === crumbs.length - 1 ? 'page' : undefined}
                    >
                      {c.label}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
            <label className="seed-fm-search">
              <Icon name="search" size={14} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search names and paths"
                aria-label="Search files"
              />
            </label>
            <select
              className="seed-fm-select"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="Sort by"
            >
              <option value="name">Name</option>
              <option value="modified">Recently modified</option>
              <option value="size">Largest</option>
            </select>
            <div className="seed-fm-viewtoggle" role="group" aria-label="View">
              <button type="button" aria-pressed={view === 'grid'} aria-label="Grid view" onClick={() => setViewChoice('grid')}>
                <Icon name="layoutGrid" size={15} />
              </button>
              <button type="button" aria-pressed={view === 'list'} aria-label="List view" onClick={() => setViewChoice('list')}>
                <Icon name="list" size={15} />
              </button>
            </div>
            {hasVariants && inImagesFolder && (
              <p className="seed-fm-hint">
                <Icon name="layers" size={13} />
                {grouped
                  ? 'Resized copies are grouped with their original image.'
                  : 'Resized copies are shown in their size folders.'}
                <button
                  type="button"
                  className="seed-fm-linkbtn"
                  onClick={() => {
                    setGrouped(!grouped)
                    setSelected(new Set())
                  }}
                >
                  {grouped ? 'Show as folders' : 'Group with originals'}
                </button>
              </p>
            )}
          </div>
        )}

        <div className={cn('body', 'seed-fm-body')}>{body}</div>

        {batchDeleteAction && (
          <div className={cn('batchBar', 'seed-fm-batch')} role="toolbar" aria-label="Selected files">
            <span className="seed-fm-batch-count" aria-live="polite">
              {selected.size} selected <span>· {formatFileSize(selectedSize)}</span>
            </span>
            <button type="button" className="seed-fm-btn" disabled={busy} onClick={() => download(selectedEntries)}>
              <Icon name="download" size={15} /> {selected.size > 1 ? 'Download .zip' : 'Download'}
            </button>
            <button
              type="button"
              className={`seed-fm-btn${batchDeleteAction.destructive ? ' seed-fm-btn--danger-text' : ''}`}
              disabled={busy}
              onClick={() => requestDelete(selectedEntries)}
            >
              <Icon name="trash" size={15} /> {batchDeleteAction.label ?? 'Delete'}
            </button>
            <button
              type="button"
              className="seed-fm-btn seed-fm-btn--icon"
              aria-label="Clear selection"
              onClick={() => setSelected(new Set())}
            >
              <Icon name="x" size={15} />
            </button>
          </div>
        )}
      </div>

      {panelEntry && (
        <PreviewPanel
          key="panel"
          entry={panelEntry}
          className={classNames.panel}
          onClose={closePanel}
          onPrevious={panelIndex > 0 ? () => setPanelPath(visible[panelIndex - 1].file.path) : null}
          onNext={
            panelIndex >= 0 && panelIndex < visible.length - 1
              ? () => setPanelPath(visible[panelIndex + 1].file.path)
              : null
          }
          onDownload={() => download([panelEntry])}
          onDelete={() => requestDelete([panelEntry])}
          deleteAction={deleteActionFor([panelEntry])}
          onCopyPath={() => copyPath(panelEntry.file.path)}
        />
      )}

      {pendingDelete && (
        <DeleteDialog
          entries={pendingDelete}
          rootPath={rootDir}
          warning={deleteWarning(pendingFiles)}
          deleteActionFor={(includeVariants) => resolveDeleteAction(filesToDelete(pendingDelete, includeVariants))}
          className={classNames.dialog}
          onCancel={() => setPendingDelete(null)}
          onConfirm={(includeVariants) => {
            const targets = filesToDelete(pendingDelete, includeVariants)
            setPendingDelete(null)
            void performDelete(targets)
          }}
        />
      )}

      {!onNotify && (
        <ul className="seed-fm-toasts" aria-live="polite">
          {toasts.map((t) => (
            <li key={t.id} className={cn('toast', `seed-fm-toast${t.tone === 'error' ? ' seed-fm-toast--error' : ''}`)}>
              <Icon name={t.tone === 'error' ? 'triangleAlert' : 'check'} size={15} strokeWidth={2.5} />
              {t.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
