/** A value that RFC 8785 canonical JSON, as this package restricts it, can't represent. */
export class CanonicalJsonError extends Error {
  readonly path: string
  constructor(path: string, reason: string) {
    super(`Can't write canonical JSON at ${path || '(root)'}: ${reason}`)
    this.name = 'CanonicalJsonError'
    this.path = path
  }
}
