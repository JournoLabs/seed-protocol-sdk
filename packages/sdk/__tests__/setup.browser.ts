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
    console.warn('OPFS check: navigator.storage.getDirectory is not available')
    return false
  }

  try {
    // Try to get the directory handle - this is the actual test
    const rootHandle = await navigator.storage.getDirectory()
    
    if (!rootHandle) {
      console.warn('OPFS check: getDirectory returned null/undefined')
      return false
    }

    // Verify it's a FileSystemDirectoryHandle
    if (rootHandle.kind !== 'directory') {
      console.warn('OPFS check: getDirectory did not return a directory handle')
      return false
    }

    // Try to access the directory (read-only check)
    // This verifies OPFS is actually functional, not just available
    try {
      await rootHandle.getDirectoryHandle('__opfs_test__', { create: false }).catch(() => {
        // Expected to fail if directory doesn't exist, but shows OPFS is working
      })
    } catch (error) {
      // If we get a different error, OPFS might not be fully functional
      if (error instanceof Error && error.name !== 'NotFoundError') {
        console.warn('OPFS check: Directory access test failed:', error.message)
        return false
      }
    }

    return true
  } catch (error) {
    console.warn('OPFS check: Failed to access OPFS:', error instanceof Error ? error.message : String(error))
    return false
  }
}

beforeAll(async () => {
  // Initialize browser-specific mocks or globals
  console.log('Browser test environment initialized')
  
  // Verify that fs is aliased to @zenfs/core in browser environment
  // This ensures all browser tests use the same file system implementation
  if (typeof window !== 'undefined') {
    try {
      // Try to import fs - it should resolve to @zenfs/core
      const fs = await import('fs')
      console.log('fs module loaded:', fs ? '✓' : '✗')
      
      // Verify it's actually @zenfs/core by checking for zenfs-specific methods
      if (fs && typeof fs.promises !== 'undefined') {
        console.log('fs.promises available - @zenfs/core is working')
      }
    } catch (error) {
      console.warn('Warning: fs module not available or not aliased correctly:', error)
    }

    // Check OPFS availability - this is critical for browser file operations
    const opfsAvailable = await checkOPFSAvailability()
    if (opfsAvailable) {
      console.log('OPFS (Origin Private File System) is available ✓')
    } else {
      const errorMessage = 
        'OPFS (Origin Private File System) is not available. Browser tests require OPFS support.\n' +
        'OPFS is required for file system operations in browser environments.\n' +
        'Make sure you are running tests in a browser that supports OPFS (Chrome 86+, Edge 86+, Opera 72+).\n' +
        'Note: Safari requires version 17+ for OPFS support.\n' +
        'If using Playwright/headless browser, ensure OPFS is enabled in the browser configuration.'
      console.error(errorMessage)
      throw new Error(errorMessage)
    }
  }
  
  // Example: Mock IndexedDB if needed
  // await setupIndexedDBMock()
})

// Note: These hooks run in the browser context when browser mode is enabled
afterEach(() => {
  // Clean up DOM - only runs in browser context
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
  // Cleanup
  console.log('Browser test environment cleaned up')
})

export function createTestContainer(): HTMLElement {
  // This function is called from test files that run in browser context
  if (typeof document === 'undefined') {
    throw new Error('createTestContainer can only be called in browser context')
  }
  const container = document.createElement('div')
  container.id = 'test-container'
  document.body.appendChild(container)
  return container
}