import type { NextConfig } from 'next';
export interface SeedNextOptions {
    /**
     * Cross-origin isolation headers for SQLite WASM, SharedArrayBuffer and OPFS, sent on every
     * path matched by `headersSource`. Set `false` to disable, or pass `{ coop, coep, corp }` to
     * override values. A COOP/COEP/CORP header your own `headers()` sets for a path wins.
     * @default true (`COOP: same-origin`, `COEP: credentialless`, `CORP: same-origin`)
     */
    isolationHeaders?: boolean | {
        coop?: string;
        coep?: string;
        corp?: string;
    };
    /**
     * Path pattern the isolation headers apply to, in Next.js `headers()` `source` syntax.
     * @default '/:path*'
     */
    headersSource?: string;
    /**
     * Modules aliased to ZenFS in browser builds (`@zenfs/core`, or `@zenfs/core/promises` for
     * ids containing "promises"). Server builds keep Node's `fs`. The list replaces the default;
     * to add a module, pass the defaults plus yours.
     * @default ['fs', 'fs/promises', 'node:fs', 'node:fs/promises']
     */
    fsModules?: string[];
}
type NextConfigFunction = (phase: string, context: {
    defaultConfig: NextConfig;
}) => NextConfig | Promise<NextConfig>;
/**
 * Add the config @seedprotocol/sdk needs in the browser to a Next.js config: `fs` aliased to
 * ZenFS in browser builds (Turbopack and webpack) and cross-origin isolation headers. Your
 * own aliases, `webpack` function and headers are kept, and win where they overlap.
 *
 * Accepts a config object or a config function, and returns the same kind.
 */
export declare function withSeed(nextConfig?: NextConfig, options?: SeedNextOptions): NextConfig;
export declare function withSeed(nextConfig: NextConfigFunction, options?: SeedNextOptions): NextConfigFunction;
export {};
//# sourceMappingURL=index.d.ts.map