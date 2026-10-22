export type ArchiveErrorCode = 'invalid_path' | 'duplicate_path' | 'invalid_bag_info'

/** A bag that can't be built as asked. `code` says why; the message names the file or field. */
export class ArchiveError extends Error {
  readonly code: ArchiveErrorCode

  constructor(code: ArchiveErrorCode, message: string) {
    super(message)
    this.name = 'ArchiveError'
    this.code = code
  }
}
