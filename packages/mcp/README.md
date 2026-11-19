# @seedprotocol/mcp

An [MCP](https://modelcontextprotocol.io) server that lets an LLM agent read content published
with [Seed Protocol](https://seedprotocol.io). It reads attestations from EAS and bodies from
Arweave through [`@seedprotocol/query`](https://www.npmjs.com/package/@seedprotocol/query), and
every result names the seed UID, version UID and attester, so the agent can cite where a passage
came from and who published it. The tools only read.

## Run it

```bash
npx -y @seedprotocol/mcp --attester 0xYourPublisherAddress
```

The server talks MCP over stdin and stdout. Clients that start local servers from a JSON config
(Claude Desktop, Cursor and others) take:

```json
{
  "mcpServers": {
    "seed-protocol": {
      "command": "npx",
      "args": ["-y", "@seedprotocol/mcp", "--attester", "0xYourPublisherAddress"],
      "env": { "EAS_CHAIN_ID": "10" }
    }
  }
}
```

In Claude Code:

```bash
claude mcp add seed-protocol -e EAS_CHAIN_ID=10 -- npx -y @seedprotocol/mcp --attester 0xYourPublisherAddress
```

| Option | |
|---|---|
| `--attester <address>` | A publisher whose seeds the server reads. Repeat for several. Also read from `SEED_MCP_ATTESTERS`, comma-separated. |
| `EAS_CHAIN_ID` | The chain the seeds are attested on. Default OP Sepolia (11155420). |
| `EAS_ENDPOINT` | The EAS GraphQL indexer. Default: the indexer for `EAS_CHAIN_ID`. |
| `ARWEAVE_HOST` | The gateway item bodies are read from. |

## Publishers

Anyone can attest under a public schema, so a schema name alone doesn't identify a publication.
With `--attester`, the server reads only seeds those addresses attested: `list_seeds` lists only
theirs, and the other tools refuse a seed anyone else attested, naming its attester.

With no `--attester`, `list_seeds` needs an `attester` argument from the agent, and the other tools
read any seed by UID. Results still name the attester.

## Tools

| Tool | Reads |
|---|---|
| `list_seeds` | Items of one schema (model name, such as `post`), newest first: title, summary, seed UID, version UID, attester and creation time. Pages with `limit` (up to 50) and `skip`. |
| `get_seed` | One item as Markdown, rendered by `itemMarkdown` from `@seedprotocol/feed`: front matter with its provenance, then the body converted from HTML. `version_uid` reads an earlier version and `as_of` the item as it was at an ISO 8601 time. Items longer than `max_chars` (default 20,000) come in parts; the result gives the next `offset`. |
| `get_changelog` | The item's versions, newest first, with when each was attested and the fields it changed. |
| `get_provenance` | The attestations the item is built from: the seed attestation, its live versions, and each property attestation of the current version with its UID, EAS type and attester. |

The server's MCP instructions tell the agent that item text is data, not instructions. An agent
can still be misled by text in an item; a client that acts on what it reads should treat it as
untrusted input.

The server doesn't decrypt `seed-private/v1` content and doesn't read licence offers.

## In code

```ts
import { createSeedMcpServer } from '@seedprotocol/mcp'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = createSeedMcpServer({ attesters: ['0xYourPublisherAddress'] })
await server.connect(new StdioServerTransport())
```

`createSeedMcpServer` returns an `McpServer` from `@modelcontextprotocol/sdk`, so it can be
connected to any of that SDK's transports. `source: 'local'` reads from a query source registered
with `registerLocalQuerySource` instead of EAS.

## License

MIT
