/** `seed-mcp`: the Seed Protocol MCP server on stdio, or over HTTP with `--http`. */
import process from 'node:process'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { homedir } from 'node:os'
import { USAGE, defaultCacheDir, parseCli } from './cli.js'
import { createSeedMcpHttpServer } from './httpNode.js'
import { createSeedMcpServer } from './server.js'

// The read cache goes to the user cache folder, not the working directory (a plugin runs in the user's project).
process.env.CACHE_DIR ||= defaultCacheDir(process.env, process.platform, homedir())

const parsed = parseCli(process.argv.slice(2), process.env)
if (parsed.kind === 'help') {
  process.stderr.write(`${USAGE}\n`)
} else if (parsed.kind === 'error') {
  process.stderr.write(`seed-mcp: ${parsed.message}\n\n${USAGE}\n`)
  process.exitCode = 2
} else if (parsed.http) {
  const { port, host, ...http } = parsed.http
  const server = createSeedMcpHttpServer({ ...parsed.options, ...http })
  server.listen(port, host, () => process.stderr.write(`seed-mcp: serving MCP at http://${host}:${port}/mcp\n`))
} else {
  // stdout carries the protocol. Anything a dependency logs goes to stderr instead.
  console.log = console.error
  console.info = console.error
  console.debug = console.error
  await createSeedMcpServer(parsed.options).connect(new StdioServerTransport())
}
