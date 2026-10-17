/**
 * Settings shared by the Seed bundler integrations (@seedprotocol/vite, @seedprotocol/next).
 * Each package inlines this module at build time, so keep it dependency-free.
 */
/** The ZenFS module an aliased `fs` specifier resolves to. */
export declare function zenfsModuleFor(fsModule: string): '@zenfs/core' | '@zenfs/core/promises';
/** Cross-origin isolation headers SQLite WASM, SharedArrayBuffer and OPFS need. */
export declare const DEFAULT_ISOLATION_HEADERS: {
    readonly 'Cross-Origin-Opener-Policy': "same-origin";
    readonly 'Cross-Origin-Embedder-Policy': "credentialless";
    readonly 'Cross-Origin-Resource-Policy': "same-origin";
};
/** The `isolationHeaders` option both integrations accept. */
export type IsolationHeadersOption = boolean | {
    coop?: string;
    coep?: string;
    corp?: string;
};
/** Header name to value, or `null` when the option disables the headers. */
export declare function resolveIsolationHeaders(option: IsolationHeadersOption | undefined): Record<string, string> | null;
/**
 * Isolation headers the user has not set in `headers` (case-insensitive), so an
 * integration can add them without replacing the user's values.
 */
export declare function isolationHeadersNotSetBy(isolationHeaders: Record<string, string>, headers: Record<string, unknown> | undefined): Record<string, string>;
/**
 * The isolation headers to send: the user's `headers` value where they set one, else ours.
 */
export declare function effectiveIsolationHeaders(isolationHeaders: Record<string, string>, headers: Record<string, unknown> | undefined): Record<string, string>;
//# sourceMappingURL=index.d.ts.map