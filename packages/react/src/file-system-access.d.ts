/**
 * Augments FileSystemDirectoryHandle with entries(), keys(), values() - methods
 * that exist at runtime but were missing from older TypeScript DOM lib types.
 * See: https://github.com/microsoft/TypeScript-DOM-lib-generator/issues/1639
 */
interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>
  keys(): AsyncIterableIterator<string>
  values(): AsyncIterableIterator<FileSystemHandle>
}
