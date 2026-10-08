import { afterAll, afterEach, beforeAll } from 'vitest'
import { cleanup } from '@testing-library/react'

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

/**
 * Remove everything in OPFS. Each test file runs in its own iframe but OPFS (the app DB and .seed files)
 * is shared across files, and several files define same-name models (e.g. 'Post'), so leftovers from one
 * file break the next depending on run order. Starting each file from an empty store avoids that.
 */
async function clearOPFS(): Promise<void> {
  const root = await navigator.storage.getDirectory()
  const names: string[] = []
  for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
    names.push(name)
  }
  for (const name of names) {
    try {
      await root.removeEntry(name, { recursive: true })
    } catch (error) {
      console.warn(`[setup.browser] Could not remove OPFS entry "${name}":`, error)
    }
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
    await clearOPFS()
  }
})

afterEach(() => {
  // Unmount everything the test rendered. Testing Library only registers this itself when vitest
  // runs with `globals: true`, which these projects don't. Clearing document.body (below, and in
  // many tests) only detaches the containers: the React roots stay mounted, so earlier tests'
  // hooks kept refetching and re-creating models while the next test's beforeEach deleted and
  // re-imported the same schema.
  cleanup()
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
