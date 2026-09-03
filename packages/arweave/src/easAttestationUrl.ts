const EAS_ATTESTATION_EXPLORER_HOST = /(^|\.)easscan\.(org|xyz)$/i

/**
 * True when `url` points at an EAS attestation explorer HTML page (not fetchable media).
 */
export function isEasAttestationExplorerUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) return false
  try {
    const parsed = new URL(trimmed)
    if (!EAS_ATTESTATION_EXPLORER_HOST.test(parsed.hostname)) {
      return false
    }
    return /\/attestation\/view\//i.test(parsed.pathname)
  } catch {
    return false
  }
}
