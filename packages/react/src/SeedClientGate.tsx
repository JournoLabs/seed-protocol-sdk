import React, { useEffect, type ReactNode } from 'react'
import { client } from '@seedprotocol/sdk'
import type { SeedConstructorOptions, SeedConfig, SchemaFileFormat } from '@seedprotocol/sdk'
import { useIsClientReady } from './client'

/** Schema input: path string or SchemaFileFormat object. Merged into config.schema at init. */
type SchemaInput = string | SchemaFileFormat

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
  /** @deprecated Schema is now loaded at init via config.schema; no separate import. Kept for backward compatibility. */
  onSchemaImportError?: (err: unknown) => void
  /** Class for the root wrapper. e.g. "relative flex h-screen w-screen" */
  wrapperClassName?: string
  /** Class for the loading overlay. e.g. "absolute inset-0 z-50 flex items-center justify-center bg-zinc-950" */
  loadingClassName?: string
  children: ReactNode
}

/**
 * Gates children until the Seed client is initialized and optionally imports a schema.
 * Mounted inside RouterProvider so we never swap the router—only the route content.
 * This avoids removeChild DOM errors and ensures QueryClientProvider stays stable.
 * Both overlay and content stay in DOM; we only toggle visibility via classes.
 */
export function SeedClientGate({
  initConfig,
  schema,
  loadingComponent,
  wrapperClassName,
  loadingClassName,
  children,
}: SeedClientGateProps) {
  const isClientReady = useIsClientReady()

  useEffect(() => {
    const effectiveConfig: SeedConstructorOptions = schema
      ? {
          ...initConfig,
          config: {
            ...initConfig.config,
            schema,
          } as SeedConfig,
        }
      : initConfig
    client.init(effectiveConfig)
  }, [initConfig, schema])

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
