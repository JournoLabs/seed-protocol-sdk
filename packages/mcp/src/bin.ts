/** `seed-mcp`: the Seed Protocol MCP server on stdio. */
import process from 'node:process'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { USAGE, parseCli } from './cli.js'
import { createSeedMcpServer } from './server.js'

// stdout carries the protocol. Anything a dependency logs goes to stderr instead.
console.log = console.error
console.info = console.error
console.debug = console.error

const parsed = parseCli(process.argv.slice(2), process.env)
if (parsed.kind === 'help') {
  process.stderr.write(`${USAGE}\n`)
} else if (parsed.kind === 'error') {
  process.stderr.write(`seed-mcp: ${parsed.message}\n\n${USAGE}\n`)
  process.exitCode = 2
} else {
  await createSeedMcpServer(parsed.options).connect(new StdioServerTransport())
}
