import { describe, it, beforeEach, afterEach } from 'vitest'
import path             from 'path'
import { PathResolver } from '@/node/PathResolver'
import process                                     from 'node:process'
import { NODE_APP_DB_CONFIG } from '@/node/constants'


describe('PathResolver', () => {
  let originalCwd: string | undefined
  beforeEach(() => {
    originalCwd = process.cwd()
  })

  afterEach(() => {
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
      const sdkDevCwd = path.join(originalCwd!, '__tests__', '__mocks__', 'sdk-dev', 'project')
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
      const linkSdkCwd = path.join(originalCwd!, '__tests__', '__mocks__', 'linked-sdk', 'project-link')
      const portalSdkCwd = path.join(originalCwd!, '__tests__', '__mocks__', 'linked-sdk', 'project-portal')
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

      const prodBrowserCwd = path.join(originalCwd!, '__tests__', '__mocks__', 'browser', 'project', 'node_modules', '@seedprotocol', 'sdk')
      const prodNodeCwd = path.join(originalCwd!, '__tests__', '__mocks__', 'node', 'project', 'node_modules', '@seedprotocol', 'sdk')

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
      const schemaFileDir = './__tests__/__mocks__/node/project'

      const resolver = PathResolver.getInstance()
      const appPaths = resolver.getAppPaths(schemaFileDir)

      expect(appPaths.appSchemaDir).toContain('.seed/schema')
      expect(appPaths.appDbDir).toContain('.seed/db')
      expect(appPaths.appMetaDir).toContain('.seed/db/meta')
      expect(appPaths.drizzleDbConfigPath).toContain(NODE_APP_DB_CONFIG)
      expect(appPaths.drizzleKitPath).toContain('drizzle-kit/bin.cjs')
      expect(appPaths.templatePath).toContain('codegen/templates')
    })

    it('should resolve app paths correctly for linked-sdk project', ( {expect} ) => {
      const originalNodeEnv = process.env.NODE_ENV
      process.env.NODE_ENV = ''

      const linkedProjectDir = path.join(originalCwd!, '__tests__', '__mocks__', 'linked-sdk', 'project-link')

      const schemaFileDir = path.join(linkedProjectDir, 'schema.ts')

      process.chdir(linkedProjectDir)

      const resolver = PathResolver.getInstance()
      const appPaths = resolver.getAppPaths(schemaFileDir)

      expect(appPaths.appSchemaDir).toContain('.seed/schema')
      expect(appPaths.appDbDir).toContain('.seed/db')
      expect(appPaths.appMetaDir).toContain('.seed/db/meta')
      expect(appPaths.drizzleDbConfigPath).toContain(NODE_APP_DB_CONFIG)
      expect(appPaths.drizzleKitPath).toContain('drizzle-kit/bin.cjs')
      expect(appPaths.templatePath).toContain('codegen/templates')

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
