import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { NextConfig } from 'next'
import {
  isolationHeadersNotSetBy,
  resolveIsolationHeaders,
  zenfsModuleFor,
} from '@seedprotocol/bundler-core'

export interface SeedNextOptions {
  /**
   * Cross-origin isolation headers for SQLite WASM, SharedArrayBuffer and OPFS, sent on every
   * path matched by `headersSource`. Set `false` to disable, or pass `{ coop, coep, corp }` to
   * override values. A COOP/COEP/CORP header your own `headers()` sets for a path wins.
   * @default true (`COOP: same-origin`, `COEP: credentialless`, `CORP: same-origin`)
   */
  isolationHeaders?:
    | boolean
    | {
        coop?: string
        coep?: string
        corp?: string
      }

  /**
   * Path pattern the isolation headers apply to, in Next.js `headers()` `source` syntax.
   * @default '/:path*'
   */
  headersSource?: string

  /**
   * Modules aliased to ZenFS in browser builds (`@zenfs/core`, or `@zenfs/core/promises` for
   * ids containing "promises"), for app code or dependencies that import Node's `fs` in the
   * browser. The SDK's browser build doesn't. Server builds keep Node's `fs`.
   * @default []
   */
  fsModules?: string[]
}

type NextConfigFunction = (
  phase: string,
  context: { defaultConfig: NextConfig },
) => NextConfig | Promise<NextConfig>

type TurbopackResolveAlias = NonNullable<NonNullable<NextConfig['turbopack']>['resolveAlias']>

/**
 * Add the config @seedprotocol/sdk needs in the browser to a Next.js config: its browser
 * entries in every graph and cross-origin isolation headers, plus any `fsModules` aliased to
 * ZenFS in browser builds. Your own aliases, `webpack` function and headers are kept, and win
 * where they overlap.
 *
 * Accepts a config object or a config function, and returns the same kind.
 */
export function withSeed(nextConfig?: NextConfig, options?: SeedNextOptions): NextConfig
export function withSeed(nextConfig: NextConfigFunction, options?: SeedNextOptions): NextConfigFunction
export function withSeed(
  nextConfig: NextConfig | NextConfigFunction = {},
  options: SeedNextOptions = {},
): NextConfig | NextConfigFunction {
  warnIfNext15Turbopack()
  if (typeof nextConfig === 'function') {
    return async (phase, context) => applySeedConfig(await nextConfig(phase, context), options)
  }
  return applySeedConfig(nextConfig, options)
}

function applySeedConfig(nextConfig: NextConfig, options: SeedNextOptions): NextConfig {
  const fsModules = options.fsModules ?? []
  const isolationHeaders = resolveIsolationHeaders(options.isolationHeaders)
  const headersSource = options.headersSource ?? '/:path*'

  const browserFsAliases: TurbopackResolveAlias = {}
  for (const mod of fsModules) browserFsAliases[mod] = { browser: zenfsModuleFor(mod) }

  // The SDK is browser-only in Next apps, but Next also bundles client components for server
  // rendering, where Node conditions pick the SDK's Node platform (libsql, native bindings) and
  // @seedprotocol/query's Node entry (a disk cache). That breaks webpack server builds and Next 15
  // Turbopack builds, and makes Next trace the whole project. Point them at their browser entries
  // in every graph; init never runs on the server.
  const browserEntries = resolveBrowserEntries()
  const browserEntryAliases: TurbopackResolveAlias = Object.fromEntries(
    Object.entries(browserEntries).map(([specifier, file]) => [specifier, turbopackPath(file)]),
  )

  const userWebpack = nextConfig.webpack
  const userHeaders = nextConfig.headers

  return {
    ...nextConfig,
    turbopack: {
      ...nextConfig.turbopack,
      // The user's aliases come last, so they replace ours for the same specifier.
      resolveAlias: { ...browserEntryAliases, ...browserFsAliases, ...nextConfig.turbopack?.resolveAlias },
    },
    webpack(config, context) {
      const result = userWebpack ? userWebpack(config, context) : config
      const existing = result.resolve?.alias ?? {}
      const added: Record<string, string> = {}
      for (const [specifier, file] of Object.entries(browserEntries)) {
        // `$` makes a webpack alias exact, so `@seedprotocol/query/node` keeps resolving normally.
        const key = specifier.startsWith('#') ? specifier : `${specifier}$`
        if (!(key in existing) && !(specifier in existing)) added[key] = file
      }
      if (!context.isServer) {
        for (const mod of fsModules) {
          if (!(mod in existing)) added[mod] = zenfsModuleFor(mod)
        }
      }
      result.resolve = { ...result.resolve, alias: { ...added, ...existing } }
      return result
    },
    ...(isolationHeaders || userHeaders
      ? {
          async headers() {
            const user = userHeaders ? await userHeaders() : []
            if (!isolationHeaders) return user
            // Next.js applies every matching rule and a later rule's value wins for the same
            // key, so ours go first. Also drop ours where a user rule for the same source sets
            // the header, which keeps the response clean for the common '/:path*' case.
            const userSameSource = user
              .filter((rule) => rule.source === headersSource)
              .flatMap((rule) => rule.headers)
            const userKeys = Object.fromEntries(userSameSource.map((header) => [header.key, header.value]))
            const ours = Object.entries(isolationHeadersNotSetBy(isolationHeaders, userKeys)).map(
              ([key, value]) => ({ key, value }),
            )
            return ours.length > 0 ? [{ source: headersSource, headers: ours }, ...user] : user
          },
        }
      : {}),
  }
}

/**
 * Specifier to absolute file of the browser entries the SDK imports, as installed for this app:
 * the SDK's browser platform for `#seed-node-platform`, and `@seedprotocol/query`'s browser
 * build, resolved from the SDK so it's the copy the SDK uses. Empty when the SDK isn't installed.
 */
function resolveBrowserEntries(): Record<string, string> {
  const entries: Record<string, string> = {}
  let sdkPackageJson: string
  try {
    sdkPackageJson = createRequire(path.join(process.cwd(), 'package.json')).resolve('@seedprotocol/sdk/package.json')
  } catch {
    return entries
  }
  entries['#seed-node-platform'] = path.join(path.dirname(sdkPackageJson), 'dist', 'platform.browser.js')
  try {
    const queryPackageJson = createRequire(sdkPackageJson).resolve('@seedprotocol/query/package.json')
    entries['@seedprotocol/query'] = path.join(path.dirname(queryPackageJson), 'dist', 'index.js')
  } catch {
    // The SDK depends on query; without it the app has bigger problems than this alias.
  }
  return entries
}

/**
 * Turbopack's resolveAlias takes project-relative paths, not absolute ones. require.resolve
 * returns real paths, so compare against the real cwd (macOS temp and home dirs can be symlinks).
 */
function turbopackPath(absolutePath: string): string {
  const relative = path.relative(fs.realpathSync(process.cwd()), absolutePath).split(path.sep).join('/')
  return relative.startsWith('.') ? relative : `./${relative}`
}

let warnedNext15Turbopack = false

/**
 * Next.js 15's Turbopack starts workers from blob: URLs and hands SQLite a root-relative WASM
 * URL, which can't be resolved there, so the SDK's database never opens. Next 15 sets
 * TURBOPACK=1 before it loads next.config for `--turbopack` dev and build runs.
 */
function warnIfNext15Turbopack(): void {
  if (warnedNext15Turbopack || process.env.TURBOPACK !== '1') return
  const major = nextMajorVersion()
  if (major !== 15) return
  warnedNext15Turbopack = true
  console.warn(
    '[@seedprotocol/next] Next.js 15 with Turbopack cannot load SQLite WASM in the browser, so the ' +
      'Seed SDK will fail to initialize. Run `next dev` and `next build` without --turbopack (webpack), ' +
      'or upgrade to Next.js 16.',
  )
}

function nextMajorVersion(): number | undefined {
  try {
    const require = createRequire(path.join(process.cwd(), 'package.json'))
    const { version } = require('next/package.json') as { version: string }
    return Number(version.split('.')[0])
  } catch {
    return undefined
  }
}
