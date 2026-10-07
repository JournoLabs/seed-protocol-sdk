import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NodePathResolver, PathResolver } from '@/node/helpers/PathResolver'
import { BasePathResolver } from '@/helpers/PathResolver/BasePathResolver'

/**
 * NodePathResolver decides where the SDK lives from process.cwd() and NODE_ENV. Each test builds the
 * project layout it needs in a fresh temp dir, chdirs into it, and afterEach restores cwd and env.
 */

const writeJson = (file: string, data: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data))
}

describe('NodePathResolver', () => {
  let originalCwd: string
  let tmpRoot: string
  let resolver: NodePathResolver

  beforeEach(() => {
    originalCwd = process.cwd()
    // realpath: on macOS os.tmpdir() is a symlink (/var -> /private/var) and process.cwd() returns the real path.
    tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seed-path-resolver-')))
    resolver = new NodePathResolver()
    vi.stubEnv('SEED_SDK_TEST_PROJECT_TYPE', undefined)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    vi.unstubAllEnvs()
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  const makeDir = (...parts: string[]) => {
    const dir = path.join(tmpRoot, ...parts)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  describe('registration', () => {
    it('is registered as the BasePathResolver implementation on import', () => {
      const instance = PathResolver.getInstance()
      expect(instance).toBeInstanceOf(NodePathResolver)
      expect(PathResolver.getInstance()).toBe(instance)
      expect(BasePathResolver.getInstance()).toBe(instance)
    })
  })

  describe('getSdkRootDir', () => {
    it('returns cwd in the test environment', () => {
      vi.stubEnv('NODE_ENV', 'test')
      const project = makeDir('project')
      process.chdir(project)
      expect(resolver.getSdkRootDir()).toBe(project)
    })

    it('returns packages/sdk when run from the monorepo root (sdk-dev)', () => {
      vi.stubEnv('NODE_ENV', '')
      makeDir('repo', 'packages', 'sdk', 'src', 'node')
      writeJson(path.join(tmpRoot, 'repo', 'packages', 'sdk', 'package.json'), { name: '@seedprotocol/sdk' })
      process.chdir(path.join(tmpRoot, 'repo'))
      expect(resolver.getSdkRootDir()).toBe(path.join(tmpRoot, 'repo', 'packages', 'sdk'))
    })

    it('returns cwd when run from the SDK package root (sdk-dev)', () => {
      vi.stubEnv('NODE_ENV', '')
      const sdk = makeDir('sdk', 'src', 'node')
      writeJson(path.join(tmpRoot, 'sdk', 'package.json'), { name: '@seedprotocol/sdk' })
      process.chdir(path.dirname(path.dirname(sdk)))
      expect(resolver.getSdkRootDir()).toBe(path.join(tmpRoot, 'sdk'))
    })

    it('does not treat a package with another name as the SDK repo', () => {
      vi.stubEnv('NODE_ENV', '')
      makeDir('other', 'src', 'node')
      writeJson(path.join(tmpRoot, 'other', 'package.json'), { name: 'something-else' })
      process.chdir(path.join(tmpRoot, 'other'))
      expect(resolver.getSdkRootDir()).toBe(path.join(tmpRoot, 'other', 'node_modules', '@seedprotocol', 'sdk', 'dist'))
    })

    it('resolves a link:@seedprotocol/sdk dependency to node_modules', () => {
      vi.stubEnv('NODE_ENV', '')
      const project = makeDir('project-link')
      writeJson(path.join(project, 'package.json'), { dependencies: { '@seedprotocol/sdk': 'link:@seedprotocol/sdk' } })
      process.chdir(project)
      expect(resolver.getSdkRootDir()).toBe(path.join(project, 'node_modules', '@seedprotocol', 'sdk'))
    })

    it('resolves a portal: dependency relative to the project', () => {
      vi.stubEnv('NODE_ENV', '')
      const project = makeDir('project-portal')
      writeJson(path.join(project, 'package.json'), { dependencies: { '@seedprotocol/sdk': 'portal:../seed-protocol-sdk' } })
      process.chdir(project)
      expect(resolver.getSdkRootDir()).toBe(path.join(tmpRoot, 'seed-protocol-sdk'))
    })

    it('defaults to node_modules/@seedprotocol/sdk/dist in production', () => {
      vi.stubEnv('NODE_ENV', 'production')
      const project = makeDir('app')
      writeJson(path.join(project, 'package.json'), { dependencies: { '@seedprotocol/sdk': '^1.0.0' } })
      process.chdir(project)
      expect(resolver.getSdkRootDir()).toBe(path.join(project, 'node_modules', '@seedprotocol', 'sdk', 'dist'))
      expect(resolver.getNodeModulesDir()).toBe(path.join(project, 'node_modules'))
    })

    it('treats a project without package.json as production', () => {
      vi.stubEnv('NODE_ENV', '')
      const project = makeDir('bare')
      process.chdir(project)
      expect(resolver.getSdkRootDir()).toBe(path.join(project, 'node_modules', '@seedprotocol', 'sdk', 'dist'))
    })
  })

  describe('getRootWithNodeModules', () => {
    it('returns cwd for a normal project', () => {
      const project = makeDir('project')
      process.chdir(project)
      expect(resolver.getRootWithNodeModules()).toBe(project)
    })

    it('climbs four levels when cwd is a __mocks__ project', () => {
      const mockProject = makeDir('sdk', '__tests__', '__mocks__', 'node', 'project')
      process.chdir(mockProject)
      expect(resolver.getRootWithNodeModules()).toBe(path.join(tmpRoot, 'sdk'))
    })
  })

  describe('getDotSeedDir', () => {
    it('uses the given schema dir', () => {
      expect(resolver.getDotSeedDir('/some/project')).toBe(path.join('/some/project', '.seed'))
    })

    it('falls back to cwd', () => {
      const project = makeDir('project')
      process.chdir(project)
      expect(resolver.getDotSeedDir()).toBe(path.join(project, '.seed'))
    })

    it('points at the mock project when SEED_SDK_TEST_PROJECT_TYPE is set', () => {
      vi.stubEnv('SEED_SDK_TEST_PROJECT_TYPE', 'node')
      const sdk = makeDir('sdk')
      process.chdir(sdk)
      expect(resolver.getDotSeedDir()).toBe(path.join(sdk, '__tests__', '__mocks__', 'node', 'project', '.seed'))
    })
  })

  describe('findConfigFile', () => {
    it('returns null when no config file exists', () => {
      expect(resolver.findConfigFile(makeDir('empty'))).toBeNull()
    })

    it('prefers seed.config.ts over the fallbacks', () => {
      const dir = makeDir('project')
      for (const name of ['seed.config.ts', 'seed.schema.ts', 'schema.ts']) {
        fs.writeFileSync(path.join(dir, name), '')
      }
      expect(resolver.findConfigFile(dir)).toBe(path.join(dir, 'seed.config.ts'))
    })

    it('tries seed.schema.ts before schema.ts', () => {
      const dir = makeDir('project')
      fs.writeFileSync(path.join(dir, 'schema.ts'), '')
      expect(resolver.findConfigFile(dir)).toBe(path.join(dir, 'schema.ts'))
      fs.writeFileSync(path.join(dir, 'seed.schema.ts'), '')
      expect(resolver.findConfigFile(dir)).toBe(path.join(dir, 'seed.schema.ts'))
    })

    it('searches cwd by default', () => {
      const dir = makeDir('project')
      fs.writeFileSync(path.join(dir, 'seed.config.ts'), '')
      process.chdir(dir)
      expect(resolver.findConfigFile()).toBe(path.join(dir, 'seed.config.ts'))
    })
  })

  describe('getAppPaths', () => {
    it('derives schema, db and meta dirs from the .seed dir', () => {
      vi.stubEnv('NODE_ENV', 'production')
      const project = makeDir('app')
      process.chdir(project)
      const dotSeed = path.join(project, '.seed')
      expect(resolver.getAppPaths(project)).toEqual({
        sdkRootDir: path.join(project, 'node_modules', '@seedprotocol', 'sdk', 'dist'),
        dotSeedDir: dotSeed,
        nodeModulesDir: path.join(project, 'node_modules'),
        appSchemaDir: path.join(dotSeed, 'schema'),
        appDbDir: path.join(dotSeed, 'db'),
        appMetaDir: path.join(dotSeed, 'db', 'meta'),
      })
    })
  })
})
