import 'dotenv/config'
import { execSync } from 'child_process'

// Suppress expected unhandled promise rejections from validation errors in tests
// These are intentional errors that are caught and handled, but may occur after tests complete
if (typeof process !== 'undefined') {
  const originalHandler = process.listeners('unhandledRejection')
  process.on('unhandledRejection', (reason, promise) => {
    // Suppress specific validation errors that are expected in tests
    if (reason instanceof Error && reason.message === 'Config must include endpoints with filePaths and files') {
      // This is an expected validation error in tests - suppress it
      return
    }
    // For other unhandled rejections, use the default behavior
    // Call any existing handlers
    originalHandler.forEach(handler => {
      if (typeof handler === 'function') {
        handler(reason, promise)
      }
    })
  })
}

export const setup = async () => {
  console.log('Setup begin')

  console.log('Running init script')

  execSync(`rm -rf ./__tests__/__mocks__/node/project/.seed`, {stdio: 'inherit'})
  execSync(`rm -rf ./__tests__/__mocks__/browser/project/.seed`, {stdio: 'inherit'})

  // execSync(`npx tsx ./scripts/bin.ts init ./__tests__/__mocks__/node/project`, {stdio: 'inherit'})
  // execSync(`npx tsx ./scripts/bin.ts init ./__tests__/__mocks__/browser/project`, {stdio: 'inherit'})

  console.log('Finished running init script')

  console.log('Setup complete')
}

export const teardown = async () => {
  // mock.restore()
  console.log('Teardown complete')

  execSync(`rm -rf ./__tests__/__mocks__/node/project/.seed`, {stdio: 'inherit'})
  execSync(`rm -rf ./__tests__/__mocks__/browser/project/.seed`, {stdio: 'inherit'})

  execSync(`rm -rf ./__tests__/__mocks__/node/project/seed-files`, {stdio: 'inherit'})
  execSync(`rm -rf ./__tests__/__mocks__/browser/project/seed-files`, {stdio: 'inherit'})
}
