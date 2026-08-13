import path from 'path'
import { execSync } from 'child_process'
import { pathToFileURL } from 'url'
import { commandExists } from '@seedprotocol/sdk/node'

export type SeedConfigModule = {
  endpoints?: Record<string, string>
  models?: Record<string, unknown>
}

/**
 * Load a seed.config.ts (or similar) without ts-import.
 * Tries native dynamic import first (works under tsx), then `node --import tsx`.
 */
export async function loadSeedConfig(configFilePath: string): Promise<SeedConfigModule> {
  const absolute = path.resolve(configFilePath)
  const url = pathToFileURL(absolute).href

  try {
    return (await import(url)) as SeedConfigModule
  } catch {
    // fall through
  }

  const nodeTsx = commandExists('tsx')
    ? `tsx -e "import('${url}').then(m => process.stdout.write(JSON.stringify({ endpoints: m.endpoints || {} })))"`
    : `node --import tsx -e "import('${url}').then(m => process.stdout.write(JSON.stringify({ endpoints: m.endpoints || {} })))"`

  const out = execSync(nodeTsx, { encoding: 'utf-8' })
  return JSON.parse(out) as SeedConfigModule
}
