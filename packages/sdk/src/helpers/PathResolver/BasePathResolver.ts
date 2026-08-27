import type { IPathResolver } from './IPathResolver'
import {
  createFacadeTestHandle,
  type PlatformTestHandle,
} from '@/testing/platformTestHandle'

export abstract class BasePathResolver {
  private static _impl: IPathResolver | null = null

  static configure(impl: IPathResolver): void {
    if (!impl) {
      throw new Error(
        'Cannot configure PathResolver with undefined or null. Ensure the platform-specific PathResolver is properly created.',
      )
    }
    BasePathResolver._impl = impl
  }

  static createForTesting(impl: IPathResolver): PlatformTestHandle {
    return createFacadeTestHandle(
      () => BasePathResolver._impl,
      (next) => {
        BasePathResolver._impl = next
      },
      impl,
    )
  }

  private static requireImpl(): IPathResolver {
    if (!BasePathResolver._impl) {
      throw new Error(
        'PathResolver not configured. Please ensure the platform-specific PathResolver is registered. For Node.js, import from @seedprotocol/sdk/node. For browser, the SDK should auto-initialize.',
      )
    }
    return BasePathResolver._impl
  }

  /**
   * @deprecated Prefer static facade methods (e.g. BasePathResolver.getDotSeedDir()).
   */
  static getInstance(): IPathResolver {
    return BasePathResolver.requireImpl()
  }

  static getRootWithNodeModules(): string {
    return BasePathResolver.requireImpl().getRootWithNodeModules()
  }

  static getSdkRootDir(): string {
    return BasePathResolver.requireImpl().getSdkRootDir()
  }

  static getNodeModulesDir(): string {
    return BasePathResolver.requireImpl().getNodeModulesDir()
  }

  static getDotSeedDir(schemaFileDir?: string): string {
    return BasePathResolver.requireImpl().getDotSeedDir(schemaFileDir)
  }

  static findConfigFile(searchDir?: string): string | null {
    return BasePathResolver.requireImpl().findConfigFile(searchDir)
  }

  static getAppPaths(schemaFileDir?: string | undefined) {
    return BasePathResolver.requireImpl().getAppPaths(schemaFileDir)
  }
}
