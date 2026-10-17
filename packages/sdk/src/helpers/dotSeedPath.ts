/**
 * Whether a relative filesDir already names the .seed directory or a path inside
 * it ('.seed', '.seed/files', './.seed/files'). '.seed-alt/x' is not: it is
 * resolved under .seed like any other relative path.
 */
export function isUnderDotSeed(relativePath: string): boolean {
  const firstSegment = relativePath.split(/[\\/]+/).find((segment) => segment !== '' && segment !== '.')
  return firstSegment === '.seed'
}
