import type { OPFSFile } from '../useOPFSFiles'

/**
 * 'system' follows prefers-color-scheme. 'none' skips the built-in stylesheet and
 * renders unstyled markup with stable `seed-fm-*` class names.
 */
export type OPFSFilesManagerTheme = 'system' | 'light' | 'dark' | 'none'

export type OPFSFilesManagerView = 'grid' | 'list'

/** Elements that accept extra classes through the `classNames` prop. */
export type OPFSFilesManagerSlot =
  | 'root'
  | 'header'
  | 'toolbar'
  | 'body'
  | 'folder'
  | 'grid'
  | 'tile'
  | 'list'
  | 'row'
  | 'batchBar'
  | 'panel'
  | 'dialog'
  | 'toast'

export type OPFSFilesManagerClassNames = Partial<Record<OPFSFilesManagerSlot, string>>

export type OPFSFilesManagerNotifyTone = 'success' | 'error'

/** What a notification is about, so hosts can write their own wording. */
export type OPFSFilesManagerNotice =
  | {
      kind: 'delete'
      deleted: string[]
      /** Paths that onBeforeDelete kept. */
      skipped: string[]
      failed: { path: string; error: string }[]
    }
  | {
      kind: 'download'
      paths: string[]
      /** Name of the saved .zip. Set when several files were saved. */
      fileName?: string
      error?: string
    }
  | { kind: 'copy-path'; path: string; error?: string }

export interface OPFSFilesManagerDeleteAction {
  /**
   * Replaces "Delete" on the batch bar, panel footer, row action and the confirm dialog's
   * heading and button. Used as-is, so it can include a count ("Remove 3 files from this device").
   */
  label?: string
  /** false drops the danger colour and uses the primary confirm button. Default: true */
  destructive?: boolean
}

/** A delete action with defaults applied. Internal. */
export interface ResolvedDeleteAction {
  label?: string
  destructive: boolean
}

export interface OPFSFilesManagerProps {
  /** Optional subdirectory to scan (e.g. 'app-files'). Default: root. */
  rootPath?: string
  /** Filter which files to include. */
  filter?: (file: OPFSFile) => boolean
  /**
   * Called for each file after the user confirms a delete, just before it's removed.
   * Return false to keep that file.
   */
  onBeforeDelete?: (file: OPFSFile) => boolean | Promise<boolean>
  /** Called after a file or files are deleted. Use for clearing app state (e.g. Seed DB). */
  onAfterDelete?: (paths: string[]) => void | Promise<void>
  /**
   * Custom download handler (e.g. Electron). If not provided, uses a browser blob download.
   * When several files are downloaded at once, this is called once with a `.zip` blob and a
   * synthetic file whose `type` is 'application/zip'.
   */
  onDownload?: (file: OPFSFile, blob: Blob) => void | Promise<void>
  /** Title for the page. Default: "Files" */
  title?: string
  /** Description text. */
  description?: string
  /** Heading level for the title. Default: 2 */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6
  /** Visual theme. Default: "system" */
  theme?: OPFSFilesManagerTheme
  /** Class for the container. */
  className?: string
  /** Extra classes for individual elements. */
  classNames?: OPFSFilesManagerClassNames
  /**
   * Starting view. By default, folders that are mostly images open as a grid and
   * everything else as a list, until the user picks a view.
   */
  defaultView?: OPFSFilesManagerView
  /**
   * Show the resized copies the SDK writes to `images/<width>/` with their original
   * image instead of as separate files. Default: true
   */
  groupImageVariants?: boolean
  /**
   * Extra warning for the delete confirmation, or null for none. The default flags
   * the Seed client's database (`db/seed.db`).
   */
  deleteWarning?: (files: OPFSFile[]) => string | null
  /**
   * Replace the built-in delete confirmation. Receives every file that will be removed,
   * including resized copies. Resolve true to delete.
   */
  confirmDelete?: (files: OPFSFile[]) => Promise<boolean>
  /**
   * Show results and errors in the host's own toaster. When set, the built-in toasts
   * aren't rendered.
   */
  /**
   * Relabel the delete action, or make it non-destructive, for the files it would remove
   * (including resized copies). Use it when the host knows those files have a copy
   * elsewhere, such as on Arweave. Runs on every render, once per list row, so keep it
   * cheap and synchronous.
   */
  deleteAction?: (files: OPFSFile[]) => OPFSFilesManagerDeleteAction
  onNotify?: (message: string, tone: OPFSFilesManagerNotifyTone, notice: OPFSFilesManagerNotice) => void
}
