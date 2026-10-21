import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getDotSeedDir } from '@/node/helpers/dotSeedDir'
import { resolveFilesDir } from '@/node/helpers/resolveFilesDir'

/**
 * Node keeps `.seed` under process.cwd(). The desktop app relies on this: its Electron main process
 * chdirs to a writable folder before init.
 */
describe('Node .seed directory', () => {
  let originalCwd: string
  let project: string

  beforeEach(() => {
    originalCwd = process.cwd()
    // realpath: on macOS os.tmpdir() is a symlink and process.cwd() returns the real path.
    project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seed-dot-seed-')))
    process.chdir(project)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(project, { recursive: true, force: true })
  })

  it('is .seed under the working directory', () => {
    expect(getDotSeedDir()).toBe(path.join(project, '.seed'))
  })

  it('holds relative and OPFS-style filesDirs', () => {
    expect(resolveFilesDir('app-files')).toBe(path.join(project, '.seed', 'app-files'))
    expect(resolveFilesDir('/app-files')).toBe(path.join(project, '.seed', 'app-files'))
    expect(resolveFilesDir('.seed/files')).toBe(path.join(project, '.seed', 'files'))
  })

  it('leaves absolute filesDirs alone', () => {
    const absolute = path.join(project, 'data', 'files')
    expect(resolveFilesDir(absolute)).toBe(absolute)
  })
})
