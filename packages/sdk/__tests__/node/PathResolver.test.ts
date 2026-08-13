import { describe, it, beforeEach, afterEach } from 'vitest'
import path             from 'path'
import { fileURLToPath } from 'node:url'
import { PathResolver } from '@/node/helpers/PathResolver'
import process                                     from 'node:process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
/** packages/sdk — mocks live under packages/sdk/__tests__/__mocks__ */
const packageRoot = path.resolve(__dirname, '../..')
const mocksRoot = path.join(packageRoot, '__tests__', '__mocks__')

describe('PathResolver', () => {
  let originalCwd: string | undefined
  beforeEach(() => {
    originalCwd = process.cwd()
  })

  afterEach(() => {
    if (originalCwd) {
      process.chdir(originalCwd)
    }
  })

  describe('Singleton Pattern', () => {
    it('should create only one instance', ({expect}) => {
      const instance1 = PathResolver.getInstance()
      const instance2 = PathResolver.getInstance()
      expect(instance1).toBe(instance2)
    })
  })

  describe('Environment Detection', () => {
    it('should detect sdk-dev environment', ({expect}) => {
      const sdkDevCwd = path.join(mocksRoot, 'sdk-dev', 'project')
      process.chdir(sdkDevCwd)

      const resolver = PathResolver.getInstance()
      const rootDir = resolver.getSdkRootDir()
      
      expect(rootDir).toContain('src')
      process.chdir(originalCwd!)
    })

    it('should detect test environment', ({expect}) => {
      const originalNodeEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'test'

      const resolver = PathResolver.getInstance()
      const dotSeedDir = resolver.getDotSeedDir()

      expect(dotSeedDir).toContain('__tests__')
      expect(dotSeedDir).toContain('__mocks__')

      process.env.NODE_ENV = originalNodeEnv
    })

    it('should detect linked-sdk environment', ({expect}) => {
      const linkSdkCwd = path.join(mocksRoot, 'linked-sdk', 'project-link')
      const portalSdkCwd = path.join(mocksRoot, 'linked-sdk', 'project-portal')
      process.chdir(linkSdkCwd)

      const resolver = PathResolver.getInstance()
      const rootDir = resolver.getRootWithNodeModules()
      
      expect(rootDir).toContain('linked-sdk')
      expect(rootDir).toContain('project-link')

      process.chdir(portalSdkCwd)

      expect(portalSdkCwd).toContain('linked-sdk')
      expect(portalSdkCwd).toContain('project-portal')

      process.chdir(originalCwd!)
    })

    it('should default to production environment', ({expect}) => {
      const originalNodeEnv = process.env.NODE_ENV
      process.env.NODE_ENV = ''

      const prodBrowserCwd = path.join(mocksRoot, 'browser', 'project', 'node_modules', '@seedprotocol', 'sdk')
      const prodNodeCwd = path.join(mocksRoot, 'node', 'project', 'node_modules', '@seedprotocol', 'sdk')

      process.chdir(prodBrowserCwd)

      const resolver = PathResolver.getInstance()
      const rootDirBrowser = resolver.getSdkRootDir()
      
      expect(rootDirBrowser).toContain('node_modules/@seedprotocol/sdk/dist')

      process.chdir(prodNodeCwd)

      const rootDirNode = resolver.getSdkRootDir()

      expect(rootDirNode).toContain('node_modules/@seedprotocol/sdk/dist')

      process.chdir(originalCwd!)
      process.env.NODE_ENV = originalNodeEnv
    })
  })

  describe('Path Resolution', () => {
    it('should resolve app paths correctly for node project', ( {expect} ) => {
      const schemaFileDir = path.join(mocksRoot, 'node', 'project')

      const resolver = PathResolver.getInstance()
      const appPaths = resolver.getAppPaths(schemaFileDir)

      expect(appPaths.appSchemaDir).toContain('.seed/schema')
      expect(appPaths.appDbDir).toContain('.seed/db')
      expect(appPaths.appMetaDir).toContain('.seed/db/meta')
    })

    it('should resolve app paths correctly for linked-sdk project', ( {expect} ) => {
      const originalNodeEnv = process.env.NODE_ENV
      process.env.NODE_ENV = ''

      const linkedProjectDir = path.join(mocksRoot, 'linked-sdk', 'project-link')

      const schemaFileDir = path.join(linkedProjectDir, 'seed.config.ts')

      process.chdir(linkedProjectDir)

      const resolver = PathResolver.getInstance()
      const appPaths = resolver.getAppPaths(schemaFileDir)

      expect(appPaths.appSchemaDir).toContain('.seed/schema')
      expect(appPaths.appDbDir).toContain('.seed/db')
      expect(appPaths.appMetaDir).toContain('.seed/db/meta')


      process.chdir(originalCwd!)

      process.env.NODE_ENV = originalNodeEnv
    })
  })

  // describe('Error Handling', () => {
  //   it('should handle filesystem errors gracefully when checking SDK repo', ({expect}) => {
  //     vi.mocked(fs.existsSync).mockImplementation(() => {
  //       throw new Error('Filesystem error')
  //     })
  //
  //     const resolver = PathResolver.getInstance()
  //     const rootDir = resolver.getRootWithNodeModules()
  //
  //     // Should default to current directory when errors occur
  //     expect(rootDir).toBe(process.cwd())
  //   })
  //
  //   it('should handle invalid package.json when checking linked SDK', ({expect}) => {
  //     vi.mocked(fs.existsSync).mockReturnValue(true)
  //     vi.mocked(fs.readFileSync).mockReturnValue('invalid json')
  //
  //     const resolver = PathResolver.getInstance()
  //     const rootDir = resolver.getRootWithNodeModules()
  //
  //     // Should default to current directory when errors occur
  //     expect(rootDir).toBe(process.cwd())
  //   })
  // })
}) 
