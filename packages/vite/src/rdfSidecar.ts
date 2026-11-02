import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ViteDevServer } from 'vite'

export type RdfSidecarOptions = {
  /** The schema file, relative to the Vite root. @default 'seedSchema.json' */
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
}
type CheckSidecar = (lens: { schema: unknown; sidecar: unknown }) => SidecarReport

async function loadCheckSidecar(root: string): Promise<CheckSidecar | undefined> {
  let entry: string
  try {
    entry = createRequire(path.join(root, 'package.json')).resolve('@seedprotocol/rdf')
  } catch {
    return undefined
  }
  const { checkSidecar } = (await import(pathToFileURL(entry).href)) as { checkSidecar?: CheckSidecar }
  return checkSidecar
}

/** What a dev server prints about the sidecar: warnings, then notes. */
function sidecarMessages(report: SidecarReport): { warnings: string[]; notes: string[] } {
  const warnings: string[] = []
  const notes: string[] = []
  for (const { id, term } of report.stale) warnings.push(`term "${term}" names ${id}, which is no model or property in the schema`)
  for (const { id, term } of report.invalid) warnings.push(`term "${term}" for ${id} isn't an IRI or a name with a prefix in @context`)
  if (report.contextOutdated || report.versionOutdated) {
    warnings.push('@context is behind the schema; run `seed-rdf sync --write`')
  }
  const unmapped = report.unmapped.filter((t) => t.property && t.id).length
  if (unmapped > 0) notes.push(`${unmapped} propert${unmapped === 1 ? 'y has' : 'ies have'} no RDF term; \`seed-rdf check\` lists them`)
  return { warnings, notes }
}

/**
 * Checks the app's RDF sidecar against its schema when the dev server starts and whenever either
 * file changes, and prints what's stale. Does nothing when there's no sidecar, and asks for
 * @seedprotocol/rdf when there is one but the app doesn't have it. Never writes either file.
 * Resolves when the first check is done.
 */
export function watchRdfSidecar(server: ViteDevServer, options: RdfSidecarOptions): Promise<void> {
  const { root, logger } = server.config
  const schemaFile = path.resolve(root, options.schema ?? 'seedSchema.json')
  const sidecarFile = options.sidecar
    ? path.resolve(root, options.sidecar)
    : schemaFile.replace(/(\.json)?$/, '.context.jsonld')
  const prefix = `[seed-protocol] ${path.relative(root, sidecarFile)}:`
  let checkSidecar: CheckSidecar | undefined
  let missingWarned = false

  const check = async () => {
    if (!fs.existsSync(sidecarFile) || !fs.existsSync(schemaFile)) return
    checkSidecar ??= await loadCheckSidecar(root)
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

  server.watcher.add([schemaFile, sidecarFile])
  const onFile = (file: string) => {
    if (path.resolve(file) === schemaFile || path.resolve(file) === sidecarFile) void run()
  }
  server.watcher.on('change', onFile)
  server.watcher.on('add', onFile)
  return run()
}

