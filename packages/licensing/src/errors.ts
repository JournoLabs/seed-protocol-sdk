/** Terms that fail {@link validateTerms}; `errors` lists each defect with its path. */
export class InvalidLicenseTermsError extends Error {
  readonly errors: { path: string; message: string }[]
  constructor(errors: { path: string; message: string }[]) {
    super(`Invalid license terms: ${errors.map((e) => `${e.path || '(root)'} ${e.message}`).join('; ')}`)
    this.name = 'InvalidLicenseTermsError'
    this.errors = errors
  }
}

/** Deeds and summary sentences exist in English only. */
export class UnsupportedLocaleError extends Error {
  readonly locale: string
  constructor(locale: string) {
    super(`No deed template for locale "${locale}"; only "en" is available`)
    this.name = 'UnsupportedLocaleError'
    this.locale = locale
  }
}

/** A value that RFC 8785 canonical JSON, as this package restricts it, can't represent. */
export class CanonicalJsonError extends Error {
  readonly path: string
  constructor(path: string, reason: string) {
    super(`Can't write canonical JSON at ${path || '(root)'}: ${reason}`)
    this.name = 'CanonicalJsonError'
    this.path = path
  }
}
