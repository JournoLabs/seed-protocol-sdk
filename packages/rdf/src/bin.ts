/** `seed-rdf check|sync|suggest`: keeps an app's RDF sidecar in step with its schema. */
import process from 'node:process'
import { runRdfCli } from './cli.js'

process.exitCode = await runRdfCli(process.argv.slice(2), {
  cwd: process.cwd(),
  out: (line) => console.log(line),
  err: (line) => console.error(line),
})
