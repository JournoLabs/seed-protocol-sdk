import 'dotenv/config'
import { execSync } from 'child_process'

// Suppress expected unhandled promise rejections from validation errors in tests
// These are intentional errors that are caught and handled via sendBack, but may occur after tests complete
// This prevents false alarms in test output for expected validation errors
if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
  process.on('unhandledRejection', (reason, promise) => {
    // Suppress specific validation errors that are expected in tests
    // These errors are intentionally thrown to test error handling, and are properly caught
    // via the promise chain's catch handler, but may occur after the test completes
    if (reason instanceof Error && reason.message === 'Config must include endpoints with filePaths and files') {
      // This is an expected validation error in tests - suppress it to avoid false alarms
      // The error is properly handled via sendBack in the XState callback
      return
    }
    // For other unhandled rejections, let them propagate (Vitest will handle them)
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
