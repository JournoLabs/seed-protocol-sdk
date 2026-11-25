import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ViteDevServer } from 'vite'

/** @seedprotocol/rdf's DEFAULT_SCHEMA_FILE; rdf isn't a dependency, so a test keeps the two equal. */
export const DEFAULT_SCHEMA_FILE = 'seed.schema.json'

export type RdfSidecarOptions = {
  /** The schema file, relative to the Vite root. @default 'seed.schema.json' */
  schema?: string
  /** The RDF sidecar, relative to the Vite root. @default the schema's path with `.context.jsonld` for `.json` */
  sidecar?: string
}

// The part of @seedprotocol/rdf's checkSidecar this reads. rdf isn't a dependency of this package:
// it's loaded from the app, and only when the app has a sidecar.
type SidecarReport = {
  stale: readonly { id: string; term: string }[]
  invalid: readonly { id: string; term: string }[]
  unmapped: readonly { model: string; property?: string; id?: string }[]
  contextOutdated: boolean
  versionOutdated: boolean
  // Absent from an older rdf.
  derivedIdsMismatch?: boolean
}
type CheckSidecar = (lens: { schema: unknown; sidecar: unknown }) => SidecarReport

/** The installed `@seedprotocol/rdf`: its ESM entry and its version. */
type RdfInstall = { entry: string; version?: string }

/**
 * @seedprotocol/rdf's ESM entry and version, from the nearest `node_modules/@seedprotocol/rdf` at or
 * above `root` whose `package.json` names an entry. Read from disk rather than with Node's resolver:
 * Node 24.21 keeps failing a resolve that failed once in this process while `node_modules/@seedprotocol/`
 * existed, which it always does beside @seedprotocol/vite, so an install during the dev server would
 * never be seen. A folder with no usable `exports` or `main`, or a `package.json` that doesn't parse,
 * is a partial install: the search goes on above it and then to the resolver.
 */
function findRdfInstall(root: string): RdfInstall | undefined {
  for (let dir = root; ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, 'node_modules/@seedprotocol/rdf/package.json')
    if (fs.existsSync(manifest)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
          version?: string
          exports?: { '.'?: { import?: { default?: string } } }
          main?: string
        }
        const entry = pkg.exports?.['.']?.import?.default ?? pkg.main
        if (entry) return { entry: path.resolve(path.dirname(manifest), entry), version: pkg.version }
      } catch {
        // An unreadable manifest is no more usable than one without an entry.
      }
    }
    if (path.dirname(dir) === dir) break
  }
  // Layouts without node_modules folders (Yarn PnP) go through the resolver.
  try {
    const entry = createRequire(path.join(root, 'package.json')).resolve('@seedprotocol/rdf')
    return { entry }
  } catch {
    return undefined
  }
}

const versionParts = (version: string): number[] => version.split(/[-+]/)[0]!.split('.').map((n) => Number.parseInt(n, 10) || 0)

/** Whether `a` is an older release than `b`; prerelease tags are ignored. */
function isOlder(a: string, b: string): boolean {
  const [x, y] = [versionParts(a), versionParts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0)
  }
  return false
}

/** This package's own version, which the rdf it loads should match or exceed. */
function ownVersion(): string | undefined {
  try {
    // Read through require: Vite's lib build inlines `new URL('../package.json', import.meta.url)`
    // as a data: URL, which readFileSync can't open.
    return (createRequire(import.meta.url)('../package.json') as { version?: string }).version
  } catch {
    return undefined
  }
}

async function loadCheckSidecar(root: string): Promise<{ checkSidecar?: CheckSidecar; outdated?: string }> {
  const install = findRdfInstall(root)
  if (!install) return {}
  const { checkSidecar } = (await import(pathToFileURL(install.entry).href)) as { checkSidecar?: CheckSidecar }
  const own = ownVersion()
  const outdated =
    own && install.version && isOlder(install.version, own)
      ? `@seedprotocol/rdf ${install.version} is older than @seedprotocol/vite ${own}; update it to ${own}`
      : undefined
  return { checkSidecar, outdated }
}

/** What a dev server prints about the sidecar: warnings, then notes. */
function sidecarMessages(report: SidecarReport): { warnings: string[]; notes: string[] } {
  const warnings: string[] = []
  const notes: string[] = []
  for (const { id, term } of report.stale) warnings.push(`term "${term}" names ${id}, which is no model or property in the schema`)
  for (const { id, term } of report.invalid) warnings.push(`term "${term}" for ${id} isn't an IRI or a name with a prefix in @context`)
  if (report.derivedIdsMismatch) {
    warnings.push('every term is stale and the schema file leaves out ids; the SDK may have stored other ids for it, put them in the schema file')
  }
  if (report.contextOutdated || report.versionOutdated) {
    warnings.push('@context is behind the schema; run `seed-rdf sync --write`')
  }
  const unmapped = report.unmapped.filter((t) => t.property && t.id).length
  if (unmapped > 0) notes.push(`${unmapped} propert${unmapped === 1 ? 'y has' : 'ies have'} no RDF term; \`seed-rdf check\` lists them`)
  return { warnings, notes }
}

/**
 * Checks the app's RDF sidecar against its schema when the dev server starts and whenever either
 * file changes, and prints what's stale. Does nothing when there's no sidecar, and asks once for
 * @seedprotocol/rdf when there is one but the app doesn't have it, then checks again when the app's
 * package.json changes. Never writes either file.
 * Resolves when the first check is done.
 */
export function watchRdfSidecar(server: ViteDevServer, options: RdfSidecarOptions): Promise<void> {
  const { root, logger } = server.config
  const schemaFile = path.resolve(root, options.schema ?? DEFAULT_SCHEMA_FILE)
  const sidecarFile = options.sidecar
    ? path.resolve(root, options.sidecar)
    : schemaFile.replace(/(\.json)?$/, '.context.jsonld')
  const prefix = `[seed-protocol] ${path.relative(root, sidecarFile)}:`
  let checkSidecar: CheckSidecar | undefined
  let missingWarned = false

  const check = async () => {
    if (!fs.existsSync(sidecarFile) || !fs.existsSync(schemaFile)) return
    if (!checkSidecar) {
      const loaded = await loadCheckSidecar(root)
      checkSidecar = loaded.checkSidecar
      if (loaded.outdated) logger.warn(`${prefix} ${loaded.outdated}`, { timestamp: true })
    }
    if (!checkSidecar) {
      if (!missingWarned) logger.warn(`${prefix} install @seedprotocol/rdf to check this sidecar against the schema`)
      missingWarned = true
      return
    }
    try {
      const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
      const { warnings, notes } = sidecarMessages(checkSidecar({ schema: read(schemaFile), sidecar: read(sidecarFile) }))
      for (const warning of warnings) logger.warn(`${prefix} ${warning}`, { timestamp: true })
      for (const note of notes) logger.info(`${prefix} ${note}`, { timestamp: true })
    } catch (error) {
      logger.warn(`${prefix} ${(error as Error).message}`, { timestamp: true })
    }
  }
  const run = () => check().catch((error: unknown) => logger.warn(`${prefix} couldn't check the sidecar: ${(error as Error).message}`))

  // Installing @seedprotocol/rdf rewrites the app's package.json, so a change there looks again
  // while the package is missing.
  const appManifest = path.resolve(root, 'package.json')
  server.watcher.add([schemaFile, sidecarFile, appManifest])
  const onFile = (file: string) => {
    const changed = path.resolve(file)
    if (changed === schemaFile || changed === sidecarFile || (changed === appManifest && !checkSidecar)) void run()
  }
  server.watcher.on('change', onFile)
  server.watcher.on('add', onFile)
  return run()
}

