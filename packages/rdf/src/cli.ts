import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { DEFAULT_SCHEMA_FILE } from './defaults.js'
import type { RdfSidecar } from './lens.js'
import { SUGGESTED_PREFIXES, checkSidecar, suggestTerms, syncSidecar, type SidecarSchema } from './sidecar.js'

const USAGE = `Usage:
  seed-rdf check   [--schema <file>] [--sidecar <file>] [--base <iri>]
      List stale terms, terms that aren't IRIs, and unmapped models and properties.
      Exits 1 when there are stale or unreadable terms.

  seed-rdf sync    [--schema <file>] [--sidecar <file>] [--base <iri>] [--write]
      Regenerate the sidecar's @context from its terms and the schema's current names, and set
      schemaVersion. Prints the result, or writes it to the sidecar with --write.

  seed-rdf suggest [--schema <file>] [--sidecar <file>] [--base <iri>] [--write]
      Draft schema.org and dcterms terms for unmapped names with a common meaning. Prints them,
      or adds them to the sidecar (creating it if needed) with --write. Review before committing.

Default --schema: ${DEFAULT_SCHEMA_FILE}. Default --sidecar: the schema's path with .context.jsonld
in place of .json.`

export type CliIo = {
  readonly cwd: string
  readonly out: (line: string) => void
  readonly err: (line: string) => void
}

class UsageError extends Error {
  constructor(
    message: string,
    readonly showUsage = false,
  ) {
    super(message)
  }
}

async function readJson<T>(file: string, what: string): Promise<T> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new UsageError(`No ${what} at ${file}`)
    throw error
  }
  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new UsageError(`The ${what} at ${file} isn't JSON: ${(error as Error).message}`)
  }
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
const target = (t: { model: string; property?: string }) => (t.property ? `${t.model}.${t.property}` : t.model)

/**
 * Runs `seed-rdf` with `args` (without the program name) and returns its exit code: 0 when done,
 * 1 when `check` finds stale or unreadable terms, 2 on a usage or input error.
 */
export async function runRdfCli(args: readonly string[], io: CliIo): Promise<number> {
  try {
    const { positionals, values } = parseArgs({
      args: [...args],
      allowPositionals: true,
      options: {
        schema: { type: 'string' },
        sidecar: { type: 'string' },
        base: { type: 'string' },
        write: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    })
    const [command, ...extra] = positionals
    if (values.help) {
      io.out(USAGE)
      return 0
    }
    if (!command || extra.length > 0 || !['check', 'sync', 'suggest'].includes(command)) {
      throw new UsageError(command ? `Unknown command: ${[command, ...extra].join(' ')}` : 'No command given', true)
    }
    if (command === 'check' && values.write) throw new UsageError('check never writes; use sync --write')

    const schemaFile = path.resolve(io.cwd, values.schema ?? DEFAULT_SCHEMA_FILE)
    const sidecarFile = values.sidecar
      ? path.resolve(io.cwd, values.sidecar)
      : schemaFile.replace(/(\.json)?$/, '.context.jsonld')
    const schema = await readJson<SidecarSchema>(schemaFile, 'schema')
    if (!schema.id) throw new UsageError(`The schema at ${schemaFile} has no id; the SDK assigns one when it writes the schema`)
    const options = { base: values.base }

    if (command === 'suggest') {
      const existing = await readJson<RdfSidecar>(sidecarFile, 'sidecar').catch((error: unknown) => {
        if (error instanceof UsageError && error.message.startsWith('No sidecar')) return undefined
        throw error
      })
      const sidecar = existing ?? { schemaId: schema.id, terms: {} }
      const suggestions = suggestTerms({ schema, sidecar })
      if (!values.write) {
        if (suggestions.length === 0) io.out('No suggestions.')
        for (const s of suggestions) io.out(`${target(s)} (${s.id}): ${s.term}`)
        return 0
      }
      const terms = { ...sidecar.terms, ...Object.fromEntries(suggestions.map((s) => [s.id, s.term])) }
      const context = { ...SUGGESTED_PREFIXES, ...sidecar['@context'] }
      await writeFile(sidecarFile, json(syncSidecar({ schema, sidecar: { ...sidecar, terms, '@context': context } }, options)))
      io.out(`Added ${suggestions.length} term${suggestions.length === 1 ? '' : 's'} to ${sidecarFile}. Review them before committing.`)
      return 0
    }

    const sidecar = await readJson<RdfSidecar>(sidecarFile, 'sidecar')
    if (command === 'sync') {
      const synced = syncSidecar({ schema, sidecar }, options)
      if (!values.write) {
        io.out(json(synced).trimEnd())
        return 0
      }
      await writeFile(sidecarFile, json(synced))
      io.out(`Wrote ${sidecarFile}`)
      return 0
    }

    const report = checkSidecar({ schema, sidecar }, options)
    if (report.stale.length > 0) {
      io.err('Stale terms (no model or property in the schema has this id):')
      for (const { id, term } of report.stale) io.err(`  ${id}: ${term}`)
    }
    if (report.invalid.length > 0) {
      io.err(`Terms that aren't an IRI or a name with a prefix in @context:`)
      for (const { id, term } of report.invalid) io.err(`  ${id}: ${term}`)
    }
    if (report.unmapped.length > 0) {
      io.out('Unmapped (exported under protocol IRIs):')
      for (const t of report.unmapped) io.out(`  ${target(t)}${t.id ? ` (${t.id})` : ' (no id yet)'}`)
    }
    if (report.contextOutdated || report.versionOutdated) {
      io.out('The sidecar is behind the schema; run `seed-rdf sync --write` to update @context and schemaVersion.')
    }
    return report.stale.length > 0 || report.invalid.length > 0 ? 1 : 0
  } catch (error) {
    if (!(error instanceof UsageError) && !(error instanceof TypeError)) throw error
    io.err(`[Seed Protocol] ${error.message}`)
    if (error instanceof UsageError && error.showUsage) io.err(USAGE)
    return 2
  }
}
