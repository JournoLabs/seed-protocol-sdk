/**
 * True in a production build. Reads the literal `process.env.NODE_ENV` so bundlers (Vite, webpack,
 * Next) compile the value in; a browser bundle with no `process` global and no replacement counts as
 * production, so dev-only warnings stay quiet there.
 */
export const isProduction = (): boolean => {
  try {
    return process.env.NODE_ENV === 'production'
  } catch {
    return true
  }
}
