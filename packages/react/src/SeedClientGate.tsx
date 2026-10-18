import React, { useEffect, useRef, type ReactNode } from 'react'
import { client } from '@seedprotocol/sdk'
import type { SeedConstructorOptions, SeedConfig, SchemaFileInput } from '@seedprotocol/sdk'
import { useIsClientReady } from './client'

/** Schema input: path string or schema object. Merged into config.schema at init. */
type SchemaInput = string | SchemaFileInput

function DefaultLoading() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        width: '100%',
      }}
    >
      Loading...
    </div>
  )
}

export type SeedClientGateProps = {
  /** Seed client init options (config + addresses). Required. */
  initConfig: SeedConstructorOptions
  /** Optional canonical schema. When provided, merged into config.schema and loaded at init (no separate import). */
  schema?: SchemaInput
  /** Custom loading UI. Default: simple centered "Loading..." text. */
  loadingComponent?: ReactNode
  /** @deprecated Never called. Schema loads at init via config.schema, and a schema that fails to load fails init: handle it in `onInitError`. */
  onSchemaImportError?: (err: unknown) => void
  /**
   * Called when client init fails; children stay hidden behind the loading UI. A
   * `FileSystemLockedError` (`code === 'OPFS_LOCKED'`) means another tab is using the app's
   * storage: offer "close other tabs / retry", where retry calls `client.init` again.
   */
  onInitError?: (err: unknown) => void
  /** Class for the root wrapper. e.g. "relative flex h-screen w-screen" */
  wrapperClassName?: string
  /** Class for the loading overlay. e.g. "absolute inset-0 z-50 flex items-center justify-center bg-zinc-950" */
  loadingClassName?: string
  children: ReactNode
}

/**
 * A dependency that changes only when `value` holds different data, so an inline object doesn't
 * re-run an effect on every render. Falls back to identity for values JSON can't encode.
 */
function valueKey(value: unknown): unknown {
  try {
    return JSON.stringify(value ?? null)
  } catch {
    return value
  }
}

/**
 * Gates children until the Seed client is initialized and optionally imports a schema.
 * Mounted inside RouterProvider so we never swap the router—only the route content.
 * This avoids removeChild DOM errors and ensures QueryClientProvider stays stable.
 * Both overlay and content stay in DOM; we only toggle visibility via classes.
 * After `client.stop()` it shows the loading state again until the next init finishes, without
 * a remount.
 */
export function SeedClientGate({
  initConfig,
  schema,
  loadingComponent,
  wrapperClassName,
  loadingClassName,
  onInitError,
  children,
}: SeedClientGateProps) {
  const isClientReady = useIsClientReady()
  // Kept in a ref so an inline callback doesn't re-run init on every render.
  const onInitErrorRef = useRef(onInitError)
  onInitErrorRef.current = onInitError
  // Compared by value, so an inline initConfig or schema doesn't re-run init on every render.
  const initConfigRef = useRef(initConfig)
  initConfigRef.current = initConfig
  const schemaRef = useRef(schema)
  schemaRef.current = schema
  const initConfigKey = valueKey(initConfig)
  const schemaKey = valueKey(schema)

  useEffect(() => {
    const initConfig = initConfigRef.current
    const schema = schemaRef.current
    const effectiveConfig: SeedConstructorOptions = schema
      ? {
          ...initConfig,
          config: {
            ...initConfig.config,
            schema,
          } as SeedConfig,
        }
      : initConfig
    client.init(effectiveConfig).catch((err: unknown) => {
      if (onInitErrorRef.current) {
        onInitErrorRef.current(err)
      } else {
        console.error('[SeedClientGate] client init failed', err)
      }
    })
  }, [initConfigKey, schemaKey])

  const loadingContent = loadingComponent ?? <DefaultLoading />

  const wrapperStyle = !wrapperClassName
    ? { position: 'relative' as const, display: 'flex' as const, height: '100vh', width: '100vw' }
    : undefined

  const overlayStyle: React.CSSProperties = {
    display: isClientReady ? 'none' : 'flex',
    ...(!loadingClassName && {
      position: 'absolute',
      inset: 0,
      zIndex: 50,
      alignItems: 'center',
      justifyContent: 'center',
    }),
  }

  const contentStyle: React.CSSProperties = {
    flex: 1,
    display: isClientReady ? 'flex' : 'none',
    flexDirection: 'column',
  }

  return (
    <div className={wrapperClassName} style={wrapperStyle}>
      <div
        className={loadingClassName}
        style={overlayStyle}
        aria-hidden={isClientReady}
      >
        {loadingContent}
      </div>
      <div style={contentStyle}>
        {children}
      </div>
    </div>
  )
}
