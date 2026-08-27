import type { IPathResolver } from './IPathResolver';
import type { PlatformTestHandle } from '@/testing/platformTestHandle';
export declare abstract class BasePathResolver {
    private static _impl;
    static configure(impl: IPathResolver): void;
    static createForTesting(impl: IPathResolver): PlatformTestHandle;
    private static requireImpl;
    /**
     * @deprecated Prefer static facade methods (e.g. BasePathResolver.getDotSeedDir()).
     */
    static getInstance(): IPathResolver;
    static getRootWithNodeModules(): string;
    static getSdkRootDir(): string;
    static getNodeModulesDir(): string;
    static getDotSeedDir(schemaFileDir?: string): string;
    static findConfigFile(searchDir?: string): string | null;
    static getAppPaths(schemaFileDir?: string | undefined): {
        sdkRootDir: string;
        dotSeedDir: string;
        nodeModulesDir: string;
        appSchemaDir: string;
        appDbDir: string;
        appMetaDir: string;
    };
}
