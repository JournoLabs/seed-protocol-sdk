export const isNode = (): boolean => {
  return (
    typeof process !== 'undefined' &&
    process.versions != null &&
    process.versions.node != null
  )
}

export const isBrowser = (): boolean => {
  return !isElectron() && typeof document !== 'undefined' && typeof window !== 'undefined'
}

export const isElectron = (): boolean => {
  return typeof process !== 'undefined' && process.versions != null && process.versions.electron != null;
}

/**
 * Detects if code is running in an Electron renderer process.
 * 
 * Uses multiple detection methods for robustness:
 * 1. Checks process.type === 'renderer' (most reliable)
 * 2. Falls back to checking if Electron is present and window/document exist
 * 
 * @returns true if running in Electron renderer process, false otherwise
 */
export const isElectronRenderer = (): boolean => {
  // Method 1: Check process.type (most reliable - official Electron API)
  if (
    typeof process !== 'undefined' &&
    (process as any).type === 'renderer'
  ) {
    return true
  }

  // Method 2: Fallback - Electron + browser-like environment
  // Renderer processes have window/document, main process doesn't (in modern Electron)
  if (
    isElectron() &&
    typeof window !== 'undefined' &&
    typeof document !== 'undefined'
  ) {
    return true
  }

  return false
}

/**
 * True where OPFS-backed Arweave file downloads should run: normal browsers and
 * Electron renderer. {@link isBrowser} is false for every Electron build (including renderer).
 */
export const supportsOpfsFileDownloads = (): boolean => {
  return isBrowser() || isElectronRenderer()
}
