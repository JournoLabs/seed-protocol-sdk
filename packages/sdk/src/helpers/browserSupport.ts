/**
 * A browser feature the SDK needs that a page can detect. See "Supported browsers" in
 * docs/GETTING_STARTED.md for the versions that have each.
 * - `opfs`: the Origin Private File System (`navigator.storage.getDirectory`).
 * - `opfs-writable`: `FileSystemFileHandle.createWritable`, used for every file write (Safari 26).
 * - `web-locks`: `navigator.locks`, used to coordinate tabs.
 * - `cross-origin-isolation`: the page was served with COOP/COEP headers, which SQLite's OPFS
 *   storage needs for `SharedArrayBuffer`. A hosting setting, not a browser version.
 */
export type BrowserFeature = 'opfs' | 'opfs-writable' | 'web-locks' | 'cross-origin-isolation'

export type BrowserSupport = {
  /** True when nothing is missing. */
  supported: boolean
  missing: BrowserFeature[]
}

/**
 * Lists the browser features the SDK needs that this page lacks, so an app can ask the user to
 * update the browser (or fix its hosting headers) before calling `client.init`. Doesn't check
 * what only exists inside workers: OPFS sync access handles (Chrome 102) and module workers
 * (Firefox 114). Outside a browser the file system features are missing.
 */
export function checkBrowserSupport(): BrowserSupport {
  const missing: BrowserFeature[] = []
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  if (typeof nav?.storage?.getDirectory !== 'function') missing.push('opfs')
  if (
    typeof FileSystemFileHandle === 'undefined' ||
    typeof FileSystemFileHandle.prototype.createWritable !== 'function'
  ) {
    missing.push('opfs-writable')
  }
  if (!nav?.locks) missing.push('web-locks')
  if (globalThis.crossOriginIsolated !== true) missing.push('cross-origin-isolation')
  return { supported: missing.length === 0, missing }
}
