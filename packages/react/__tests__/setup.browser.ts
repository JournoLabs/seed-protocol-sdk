import { afterAll, afterEach, beforeAll } from 'vitest'

/**
 * Check if OPFS (Origin Private File System) is available in the browser
 * OPFS is required for file system operations in browser environments
 */
async function checkOPFSAvailability(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false
  }

  // Check if navigator.storage exists
  if (!navigator.storage) {
    console.warn('OPFS check: navigator.storage is not available')
    return false
  }

  // Check if getDirectory method exists
  if (typeof navigator.storage.getDirectory !== 'function') {
    console.warn('OPFS check: getDirectory returned null/undefined')
    return false
  }

  try {
    const rootHandle = await navigator.storage.getDirectory()
    if (!rootHandle || rootHandle.kind !== 'directory') {
      return false
    }
    return true
  } catch {
    return false
  }
}

beforeAll(async () => {
  if (typeof window !== 'undefined') {
    const opfsAvailable = await checkOPFSAvailability()
    if (!opfsAvailable) {
      throw new Error(
        'OPFS is required for browser tests. Use Chrome 86+, Edge 86+, or Safari 17+.'
      )
    }
  }
})

afterEach(() => {
  if (typeof document !== 'undefined') {
    document.body.innerHTML = ''
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.clear()
  }
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.clear()
  }
})

afterAll(async () => {
  console.log('Browser test environment cleaned up')
})

export function createTestContainer(): HTMLElement {
  if (typeof document === 'undefined') {
    throw new Error('createTestContainer can only be called in browser context')
  }
  const container = document.createElement('div')
  container.id = 'test-container'
  document.body.appendChild(container)
  return container
}
