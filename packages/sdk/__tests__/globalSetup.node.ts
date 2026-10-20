import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    /** Parent of every Node test file's temp project dir for this run (see getTestProjectPath). */
    seedTestRunDir: string
  }
}

// Vitest stops each forked worker with SIGTERM, so a worker's process.on('exit') handlers never run
// and test files can't defer their temp dir removal to exit. Removing a file's dir in its own afterAll
// risks SQLITE_READONLY_DBMOVED from writes still in flight. Instead every file's dir goes under one
// run dir, removed here in the main process after all workers are gone.
export default function setup(project: TestProject) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-test-run-'))
  project.provide('seedTestRunDir', runDir)
  return () => {
    fs.rmSync(runDir, { recursive: true, force: true })
  }
}
