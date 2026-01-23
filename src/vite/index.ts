import type { Plugin, ResolvedConfig } from 'vite'

// Get the plugin file's URL to use as importer context for resolving SDK dependencies
// @ts-expect-error - import.meta.url is valid in ESM but TypeScript config may not recognize it
const PLUGIN_FILE_URL = import.meta.url

export interface SeedVitePluginOptions {
  /**
   * Custom ZenFS configuration to apply on initialization
   */
  zenfsConfig?: Record<string, unknown>
  
  /**
   * Additional modules to alias to ZenFS equivalents
   * @default ['fs', 'fs/promises', 'node:fs', 'node:fs/promises']
   */
  fsModules?: string[]
  
  /**
   * Whether to inject automatic ZenFS initialization
   * @default true
   */
  autoInit?: boolean
  
  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean
  
  /**
   * Entry points to scan for dependencies during initial optimization.
   * This helps prevent incremental dependency discovery and multiple reloads.
   * Can be file paths or glob patterns relative to the project root.
   * If not provided, the plugin will attempt to auto-detect SDK entry points.
   */
  entryPoints?: string[]
  
  /**
   * Whether to automatically include common SDK dependencies in optimizeDeps.include.
   * Set to false if these dependencies are not installed in your project.
   * @default false
   */
  autoIncludeDeps?: boolean
}

const DEFAULT_FS_MODULES = [
  'fs',
  'fs/promises',
  'node:fs',
  'node:fs/promises',
]

// Modules that other polyfill plugins commonly alias fs to
const KNOWN_POLYFILL_TARGETS = [
  'memfs',
  'browserfs',
  'rollup-plugin-node-polyfills/polyfills/fs',
  'vite-plugin-node-polyfills/shims/fs',
  'node-stdlib-browser/esm/mock/empty',
  'node-stdlib-browser/esm/mock/empty.js',
  '\0vite/node-polyfills/fs',
  '\0node-polyfills:fs',
  'empty',
  '\0empty',
  '__vite-browser-external',
]

// Common dependencies that are frequently used by the SDK and should be pre-optimized
// to prevent incremental discovery and multiple reloads
// Note: Only include these if autoIncludeDeps is enabled, as they might not be
// installed in the consuming project (they're in the SDK's node_modules)
const COMMON_DEPENDENCIES = [
  '@zenfs/core',
  '@zenfs/dom',
  'path-browserify',
  'graphql-request',
  'tslib',
  'reflect-metadata',
  '@sinclair/typebox',
  '@sinclair/typebox/value',
  'immer',
  'rxjs',
  'xstate',
  'lodash-es',
  'use-immer',
  '@xstate/react',
  'ethers',
  'eventemitter3',
  '@statelyai/inspect',
  'arweave',
  // Note: node:crypto is a Node.js built-in and cannot be optimized
]

export function seedVitePlugin(options: SeedVitePluginOptions = {}): Plugin[] {
  const {
    fsModules = DEFAULT_FS_MODULES,
    autoInit = true,
    debug = false,
    entryPoints,
    autoIncludeDeps = false,
  } = options

  const log = (...args: unknown[]) => {
    if (debug) console.log('[seed-vite-plugin]', ...args)
  }

  let config: ResolvedConfig

  // Track what other plugins have done to fs
  const interceptedResolutions = new Map<string, string>()

  /**
   * First plugin: runs early to observe what other plugins do and set up aliases
   */
  const observerPlugin: Plugin = {
    name: 'seed-protocol:observer',
    enforce: 'pre',

    config(userConfig, env) {
      // Set up aliases early to override other plugins' fs polyfills
      const aliases: Array<{ find: string | RegExp; replacement: string }> = []
      
      for (const fsModule of fsModules) {
        const isPromiseVariant = fsModule.includes('promises')
        const zenfsModule = isPromiseVariant ? '@zenfs/core/promises' : '@zenfs/core'
        aliases.push({
          find: new RegExp(`^${fsModule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
          replacement: zenfsModule,
        })
      }
      
      // Also alias the node-stdlib-browser empty mock to @zenfs/core
      // This ensures Vite can resolve it properly without needing manual resolution
      aliases.push(
        {
          find: /^node-stdlib-browser\/esm\/mock\/empty(\.js)?$/,
          replacement: '@zenfs/core',
        },
        {
          find: /node-stdlib-browser\/esm\/mock\/empty(\.js)?$/,
          replacement: '@zenfs/core',
        }
      )

      return {
        resolve: {
          alias: aliases,
        },
        optimizeDeps: {
          exclude: [
            'fs', 
            'node:fs', 
            'fs/promises', 
            'node:fs/promises',
            // Also exclude the empty mock to prevent it from being cached
            'node-stdlib-browser/esm/mock/empty',
            'node-stdlib-browser/esm/mock/empty.js',
            // Exclude drizzle-kit and database drivers that it dynamically imports
            // These are dev tools and should not be bundled
            'drizzle-kit',
            '@electric-sql/pglite',
            'pg',
            'postgres',
            '@vercel/postgres',
            '@neondatabase/serverless',
            'mysql2',
            'mysql2/promise',
            '@planetscale/database',
          ],
        },
      }
    },

    async resolveId(source, importer, options) {
      // Remove query parameters for matching
      const sourceWithoutQuery = source.split('?')[0]
      
      // Intercept fs imports early, before other plugins can create polyfills
      if (fsModules.includes(source) || fsModules.includes(sourceWithoutQuery)) {
        log(`[observer] Early interception of: "${source}" from ${importer}`)
        
        const isPromiseVariant = source.includes('promises')
        const zenfsModule = isPromiseVariant ? '@zenfs/core/promises' : '@zenfs/core'
        
        // Resolve from plugin's context (SDK's node_modules)
        const resolved = await this.resolve(zenfsModule, PLUGIN_FILE_URL, {
          ...options,
          skipSelf: true,
        })
        
        if (resolved) {
          log(`[observer] Resolved to: ${resolved.id}`)
          return resolved
        }
      }
      
      // Also intercept node-stdlib-browser empty mock if it's being used
      // Match various formats: full path, relative path, with/without query params
      if (
        source.includes('node-stdlib-browser') && 
        (source.includes('mock/empty') || source.includes('empty.js'))
      ) {
        log(`[observer] Intercepting node-stdlib-browser empty mock: "${source}"`)
        const isPromiseVariant = source.includes('promises')
        const zenfsModule = isPromiseVariant ? '@zenfs/core/promises' : '@zenfs/core'
        
        // Try resolving from plugin context first (SDK's node_modules)
        let resolved = await this.resolve(zenfsModule, PLUGIN_FILE_URL, {
          ...options,
          skipSelf: true,
        })
        
        // If that fails and we have an importer, try resolving from the importer
        if (!resolved && importer) {
          resolved = await this.resolve(zenfsModule, importer, {
            ...options,
            skipSelf: true,
          })
        }
        
        if (resolved) {
          log(`[observer] Resolved empty mock to: ${resolved.id}`)
          return resolved
        }
        
        // If resolution fails, return null and let Vite handle it naturally
        // Vite should be able to resolve @zenfs/core from node_modules
        log(`[observer] Resolution failed, letting Vite handle: ${zenfsModule}`)
        return null
      }
      
      return null
    },

    configResolved(resolvedConfig) {
      config = resolvedConfig

      // Log any fs-related aliases from other plugins
      const aliases = resolvedConfig.resolve.alias
      if (debug && aliases) {
        const aliasArray = Array.isArray(aliases) ? aliases : Object.entries(aliases)
        for (const alias of aliasArray) {
          const [find, replacement] = Array.isArray(alias) 
            ? [alias[0], alias[1]] 
            : [alias.find, alias.replacement]
          
          if (typeof find === 'string' && fsModules.some(m => find.includes('fs'))) {
            log(`Detected existing alias: ${find} -> ${replacement}`)
          }
        }
      }
    },
  }

  /**
   * Main plugin: enforced to run last in the chain
   */
  const mainPlugin: Plugin = {
    name: 'seed-protocol:main',
    enforce: 'post',

    config(userConfig, env) {
      // Pre-optimize common dependencies to prevent incremental discovery
      // This reduces the number of reloads by ensuring dependencies are optimized upfront
      // Note: Only include if autoIncludeDeps is true, as these dependencies might not
      // be installed in the consuming project (they're in the SDK's node_modules)
      const existingInclude = userConfig.optimizeDeps?.include || []
      // Normalize entries to always be an array (Vite allows string | string[])
      const existingEntriesRaw = userConfig.optimizeDeps?.entries
      const existingEntries = Array.isArray(existingEntriesRaw)
        ? existingEntriesRaw
        : existingEntriesRaw
        ? [existingEntriesRaw]
        : []
      
      const optimizeDepsConfig: {
        include?: string[]
        entries?: string[]
        esbuildOptions?: {
          define?: Record<string, string>
        }
      } = {
        esbuildOptions: {
          define: {
            global: 'globalThis',
          },
        },
      }

      // Only auto-include dependencies if explicitly enabled
      // Vite will discover dependencies automatically if they're imported
      if (autoIncludeDeps) {
        const include = Array.isArray(existingInclude)
          ? [...new Set([...existingInclude, ...COMMON_DEPENDENCIES])]
          : [...COMMON_DEPENDENCIES]
        optimizeDepsConfig.include = include
        if (debug) {
          log(`[main] Auto-including common dependencies: ${COMMON_DEPENDENCIES.join(', ')}`)
        }
      } else if (Array.isArray(existingInclude) && existingInclude.length > 0) {
        // Preserve existing includes if provided
        optimizeDepsConfig.include = existingInclude
      }

      // If entry points are provided, merge them with existing entries
      // This helps Vite discover all dependencies during initial optimization
      if (entryPoints && entryPoints.length > 0) {
        const mergedEntries = Array.isArray(existingEntries)
          ? [...new Set([...existingEntries, ...entryPoints])]
          : entryPoints
        optimizeDepsConfig.entries = mergedEntries
        if (debug) {
          log(`[main] Using entry points for dependency scanning: ${mergedEntries.join(', ')}`)
        }
      } else if (existingEntries.length > 0) {
        // Preserve existing entries even if none provided
        optimizeDepsConfig.entries = existingEntries
      }

      // Configure build externals to prevent bundling Node.js-only packages
      // These packages should not be bundled for browser builds
      const nodeOnlyPackages = [
        'drizzle-kit',
        '@electric-sql/pglite',
        'pg',
        'postgres',
        '@vercel/postgres',
        '@neondatabase/serverless',
        'mysql2',
        'mysql2/promise',
        '@planetscale/database',
        'better-sqlite3',
        'nunjucks',
        'fsevents',
      ]

      // Node.js built-in modules that should be externalized
      const nodeBuiltins = [
        'url',
        'path',
        'http',
        'http2',
        'stream',
        'crypto',
        'net',
        'https',
        'zlib',
        'child_process',
        'fs',
        'fs/promises',
        'node:fs',
        'node:fs/promises',
        'node:url',
        'node:path',
        'node:http',
        'node:http2',
        'node:stream',
        'node:crypto',
        'node:net',
        'node:https',
        'node:zlib',
        'node:child_process',
      ]

      const existingExternal = userConfig.build?.rollupOptions?.external
      const existingExternalArray = Array.isArray(existingExternal)
        ? existingExternal
        : typeof existingExternal === 'string'
        ? [existingExternal]
        : []

      // Merge with existing externals, avoiding duplicates
      const allExternals = [
        ...new Set([
          ...existingExternalArray,
          ...nodeOnlyPackages,
          ...nodeBuiltins,
        ]),
      ]

      // Create external function that checks both our list and user's function
      const externalFunction = (id: string, importer?: string, isResolved?: boolean): boolean => {
        // Check if it's a node-only package (exact match or subpath)
        if (nodeOnlyPackages.some(pkg => id === pkg || id.startsWith(`${pkg}/`))) {
          if (debug) {
            log(`[build] Externalizing node-only package: ${id}`)
          }
          return true
        }

        // Check if it's a Node.js built-in
        if (nodeBuiltins.includes(id)) {
          if (debug) {
            log(`[build] Externalizing Node.js built-in: ${id}`)
          }
          return true
        }

        // If user provided a function, call it first
        if (typeof existingExternal === 'function') {
          const userResult = existingExternal(id, importer, isResolved ?? false)
          if (userResult) return true
        }

        // Otherwise check if it's in the array
        return allExternals.includes(id)
      }

      // Configure worker format to 'es' to support code-splitting
      // This is required for packages like sqlocal that use workers with dynamic imports
      // Only set format if user hasn't explicitly configured it
      const existingWorkerConfig = userConfig.worker
      const workerConfig = existingWorkerConfig
        ? {
            ...existingWorkerConfig,
            // Only override format if not already set (default is 'iife' which causes issues)
            format: (existingWorkerConfig.format === 'es' || existingWorkerConfig.format === 'iife' 
              ? existingWorkerConfig.format 
              : 'es') as 'es' | 'iife',
          }
        : {
            format: 'es' as const,
          }

      return {
        optimizeDeps: optimizeDepsConfig,
        worker: workerConfig,
        build: {
          rollupOptions: {
            // Always use the function if we have node-only packages to externalize
            // or if the user provided an external function
            // Otherwise, use the array if we have externals
            external:
              nodeOnlyPackages.length > 0 || typeof existingExternal === 'function'
                ? externalFunction
                : allExternals.length > 0
                ? allExternals
                : undefined,
          },
        },
      }
    },

    async resolveId(source, importer, options) {
      // Check if this is an fs-related import we should intercept
      const shouldIntercept = fsModules.includes(source) || 
        KNOWN_POLYFILL_TARGETS.some(target => source.includes(target) || source === target)

      // Also intercept node-stdlib-browser empty mock paths
      if (source.includes('node-stdlib-browser') && source.includes('mock/empty')) {
        log(`Intercepting node-stdlib-browser empty mock: "${source}"`)
        const isPromiseVariant = source.includes('promises')
        const zenfsModule = isPromiseVariant ? '@zenfs/core/promises' : '@zenfs/core'
        
        // Try resolving from plugin context first (SDK's node_modules)
        let resolved = await this.resolve(zenfsModule, PLUGIN_FILE_URL, {
          ...options,
          skipSelf: true,
        })
        
        // If that fails and we have an importer, try resolving from the importer
        if (!resolved && importer) {
          resolved = await this.resolve(zenfsModule, importer, {
            ...options,
            skipSelf: true,
          })
        }
        
        if (resolved) {
          log(`Resolved empty mock to: ${resolved.id}`)
          interceptedResolutions.set(source, resolved.id)
          return resolved
        }
        
        // If resolution fails, return null and let Vite handle it naturally
        // The alias configuration should handle the resolution
        log(`Resolution failed, letting Vite handle: ${zenfsModule}`)
        return null
      }

      if (!shouldIntercept) {
        // Also intercept if source is a Vite pre-bundled fs polyfill path or node-stdlib-browser mock
        const sourceWithoutQuery = source.split('?')[0]
        if (
          source.includes('node_fs') || 
          (source.includes('.vite/deps') && source.includes('fs') && !source.includes('@zenfs')) ||
          (source.includes('node-stdlib-browser') && (source.includes('mock/empty') || source.includes('empty.js')))
        ) {
          log(`Intercepting Vite pre-bundled fs polyfill/mock: "${source}"`)
          const isPromiseVariant = source.includes('promises')
          const zenfsModule = isPromiseVariant ? '@zenfs/core/promises' : '@zenfs/core'
          
          // For .vite/deps paths, let the load hook handle them to avoid chunk reference issues
          if (source.includes('.vite/deps')) {
            // Return null to let Vite continue, then the load hook will intercept
            return null
          }
          
          // For other cases, resolve the module
          let resolved = await this.resolve(zenfsModule, importer || PLUGIN_FILE_URL, {
            ...options,
            skipSelf: true,
          })
          
          if (resolved) {
            log(`Resolved pre-bundled fs to: ${resolved.id}`)
            interceptedResolutions.set(source, resolved.id)
            return resolved
          }
          
          // Fallback: return the module specifier
          log(`Fallback: returning module specifier: ${zenfsModule}`)
          interceptedResolutions.set(source, zenfsModule)
          return { id: zenfsModule, external: false }
        }
        return null
      }

      log(`Intercepting resolution: "${source}" from ${importer}`)

      // Determine the correct ZenFS module
      const isPromiseVariant = source.includes('promises')
      const zenfsModule = isPromiseVariant ? '@zenfs/core/promises' : '@zenfs/core'

      // First, try resolving from the plugin's context (SDK's node_modules)
      // This ensures we use the SDK's dependencies even if the consuming project doesn't have them
      let resolved = await this.resolve(zenfsModule, PLUGIN_FILE_URL, {
        ...options,
        skipSelf: true,
      })

      // If that fails, try resolving from the original importer (project's node_modules)
      if (!resolved && importer) {
        resolved = await this.resolve(zenfsModule, importer, {
          ...options,
          skipSelf: true,
        })
      }

      if (resolved) {
        log(`Resolved to: ${resolved.id}`)
        interceptedResolutions.set(source, resolved.id)
        return resolved
      }

      // Fallback: return the module specifier and let Vite handle it
      // Vite should be able to resolve from parent node_modules automatically
      log(`Fallback resolution for: ${zenfsModule}`)
      return { id: zenfsModule, external: false }
    },

    shouldTransformCachedModule({ id, code }) {
      // Force transformation of cached fs polyfill modules
      const idWithoutQuery = id.split('?')[0]
      const isFsPolyfill = 
        idWithoutQuery.includes('node_fs') || 
        (idWithoutQuery.includes('.vite/deps') && idWithoutQuery.includes('fs') && !idWithoutQuery.includes('@zenfs')) ||
        (idWithoutQuery.includes('node-stdlib-browser') && (idWithoutQuery.includes('mock/empty') || idWithoutQuery.includes('empty.js')))
      
      if (isFsPolyfill) {
        log(`Forcing transformation of cached fs polyfill: ${id}`)
        return true
      }
      return false
    },

    load(id) {
      // Remove query parameters for matching (e.g., ?v=392cb483)
      const idWithoutQuery = id.split('?')[0]
      
      // Intercept Vite's pre-bundled fs polyfill and replace it with ZenFS
      // Also intercept node-stdlib-browser's empty mock
      // Handle both regular paths and /@fs/ prefixed paths
      const isFsPolyfill = 
        idWithoutQuery.includes('node_fs') || 
        (idWithoutQuery.includes('.vite/deps') && idWithoutQuery.includes('fs') && !idWithoutQuery.includes('@zenfs')) ||
        (idWithoutQuery.includes('node-stdlib-browser') && (idWithoutQuery.includes('mock/empty') || idWithoutQuery.includes('empty.js')))
      
      if (isFsPolyfill) {
        log(`Intercepting load of fs polyfill/mock file: ${id}`)
        const isPromiseVariant = idWithoutQuery.includes('promises')
        const zenfsModule = isPromiseVariant ? '@zenfs/core/promises' : '@zenfs/core'
        
        // Return a re-export from ZenFS
        return `export * from '${zenfsModule}'; export { default } from '${zenfsModule}';`
      }
      return null
    },

    handleHotUpdate({ file, server }) {
      // Invalidate modules that import fs when the plugin file changes
      // This helps with HMR scenarios where the cache might be stale
      if (file.includes('node-stdlib-browser') && file.includes('empty')) {
        log(`Invalidating modules due to fs polyfill change: ${file}`)
        // Let Vite handle the invalidation naturally
        return undefined
      }
      return undefined
    },

    transform(code, id) {
      // Skip node_modules except for specific problematic packages
      if (id.includes('node_modules') && !id.includes('@seedprotocol')) {
        return null
      }

      // Handle dynamic imports of fs
      const dynamicFsImportPattern = /import\s*\(\s*['"`](fs|node:fs|fs\/promises|node:fs\/promises)['"`]\s*\)/g
      
      if (dynamicFsImportPattern.test(code)) {
        log(`Transforming dynamic fs imports in: ${id}`)
        
        const transformed = code.replace(dynamicFsImportPattern, (match, moduleName) => {
          const isPromise = moduleName.includes('promises')
          const replacement = isPromise ? '@zenfs/core/promises' : '@zenfs/core'
          return `import('${replacement}')`
        })

        return {
          code: transformed,
          map: null,
        }
      }

      return null
    },

    transformIndexHtml(html) {
      if (!autoInit) return html

      // Inject ZenFS initialization script before other scripts
      const initScript = `
<script type="module">
  import { configure } from '@zenfs/core';
  import { IndexedDB } from '@zenfs/dom';
  
  window.__seedFsReady = configure({
    mounts: {
      '/': IndexedDB,
    },
  }).then(() => {
    console.log('[seed-protocol] ZenFS initialized');
  }).catch(err => {
    console.error('[seed-protocol] ZenFS initialization failed:', err);
  });
</script>`

      // Insert before closing head tag or at the start of body
      if (html.includes('</head>')) {
        return html.replace('</head>', `${initScript}\n</head>`)
      }
      
      return html.replace('<body>', `<body>\n${initScript}`)
    },

    buildEnd() {
      if (debug && interceptedResolutions.size > 0) {
        log('Summary of intercepted resolutions:')
        for (const [source, target] of interceptedResolutions) {
          log(`  ${source} -> ${target}`)
        }
      }
    },
  }

  /**
   * Cleanup plugin: catches any remaining fs references in the final bundle
   */
  const cleanupPlugin: Plugin = {
    name: 'seed-protocol:cleanup',
    enforce: 'post',
    apply: 'build',

    generateBundle(options, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk') continue

        // Check for any remaining problematic fs references
        const problematicPatterns = [
          /require\s*\(\s*['"`]fs['"`]\s*\)/g,
          /from\s*['"`]fs['"`]/g,
          /__vite-browser-external.*fs/g,
        ]

        let hasIssue = false
        for (const pattern of problematicPatterns) {
          if (pattern.test(chunk.code)) {
            hasIssue = true
            log(`Warning: Potential unresolved fs reference in ${fileName}`)
            break
          }
        }

        if (hasIssue && debug) {
          // Log the context around the problematic reference
          const lines = chunk.code.split('\n')
          lines.forEach((line, i) => {
            if (line.includes('fs') && (line.includes('require') || line.includes('from'))) {
              log(`  Line ${i + 1}: ${line.substring(0, 100)}...`)
            }
          })
        }
      }
    },
  }

  return [observerPlugin, mainPlugin, cleanupPlugin]
}

/**
 * Helper to ensure ZenFS is ready before using fs operations
 */
export async function waitForFs(): Promise<void> {
  if (typeof window !== 'undefined' && window.__seedFsReady) {
    await window.__seedFsReady
  }
}

// Type augmentation for the window object
declare global {
  interface Window {
    __seedFsReady?: Promise<void>
  }
}

export default seedVitePlugin