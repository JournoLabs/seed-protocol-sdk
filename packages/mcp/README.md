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
      "env": { "EAS_CHAIN_ID": "11155420" }
    }
  }
}
```

In Claude Code:

```bash
claude mcp add seed-protocol -e EAS_CHAIN_ID=11155420 -- npx -y @seedprotocol/mcp --attester 0xYourPublisherAddress
```

| Option | |
|---|---|
| `--attester <address>` | A publisher whose seeds the server reads. Repeat for several. Also read from `SEED_MCP_ATTESTERS`, comma-separated. |
| `EAS_CHAIN_ID` | The chain the seeds are attested on. Default OP Sepolia (11155420). |
| `EAS_ENDPOINT` | The EAS GraphQL indexer. Default: the indexer for `EAS_CHAIN_ID`. |
| `ARWEAVE_HOST` | The gateway item bodies are read from. |

## Run it over HTTP

Hosted assistants, such as claude.ai and ChatGPT connectors, reach an MCP server by URL rather than
starting it. `--http` serves the same tools over Streamable HTTP at `/mcp`:

```bash
npx -y @seedprotocol/mcp --attester 0xYourPublisherAddress --http --port 3000 --host 0.0.0.0
```

Put it behind a TLS proxy and give clients `https://your.host/mcp`. claude.ai connects only on port
443. The endpoint needs no sign-in: in the connector settings choose no authentication.

| Option | |
|---|---|
| `--port <n>` | Default 3000. |
| `--host <address>` | Default `127.0.0.1`. |
| `--allowed-origin <origin>` | A browser origin allowed to call, such as an MCP inspector's. Repeat for several. Requests with any other `Origin` header get 403. Requests with no `Origin` header, which is how hosted connectors call, are accepted. |
| `--rate-limit <n>` | Requests per minute per client address, with bursts of the same size. Over the limit, requests get 429 with `Retry-After`. Default 120; `0` turns it off. A client sends one request per tool call, plus two to connect. |
| `--trust-proxy` | Take the client address from the last `X-Forwarded-For` entry, the one your proxy added, instead of the socket. Set it only behind a proxy that adds the header. |
| `CACHE_DIR`, `CACHE_TTL`, `CACHE_ENABLED` | The on-disk cache of EAS and Arweave reads from `@seedprotocol/query` (default: `seed-mcp` in the user cache folder, one hour: `~/Library/Caches` on macOS, `$XDG_CACHE_HOME` or `~/.cache` on Linux, `%LOCALAPPDATA%` on Windows). Repeat reads of a seed are served from it. |

The server keeps no sessions and answers each request with JSON, so several instances can serve
one URL. `GET` and `DELETE` get 405. Request bodies over 1 MB get 413.

## Use it from an assistant

The [`reading-seed-records` skill](../../plugins/seed-protocol/skills/reading-seed-records/SKILL.md)
tells an agent how to find, read and cite Seed records with these tools. Install it alongside the
server where the client supports skills.

**Claude Code.** The [Seed Protocol plugin](../../plugins/seed-protocol/README.md) starts the server
and adds the skill:

```text
/plugin marketplace add JournoLabs/seed-protocol-sdk
/plugin install seed-protocol@seed-protocol
```

It asks for publisher addresses and a chain ID, both optional; change them with
`/plugin configure seed-protocol@seed-protocol`.

**Claude Desktop.** Add the JSON config from [Run it](#run-it) to `claude_desktop_config.json`. To
add the skill, zip the `plugins/seed-protocol/skills/reading-seed-records` folder and upload it
under Skills in Claude's settings.

**Hermes.** Add the server to `~/.hermes/config.yaml`, then run `/reload-mcp`:

```yaml
mcp_servers:
  seed-protocol:
    command: npx
    args: ["-y", "@seedprotocol/mcp"]
    env:
      SEED_MCP_ATTESTERS: "0xYourPublisherAddress"
      EAS_CHAIN_ID: "11155420"
```

Copy the `plugins/seed-protocol/skills/reading-seed-records` folder into `~/.hermes/skills/` for
the skill.

**claude.ai and ChatGPT.** These reach the server by URL. Serve it with `--http` as in
[Run it over HTTP](#run-it-over-http) and add `https://your.host/mcp` as a custom connector with no
authentication. The skill can be uploaded to claude.ai as for Claude Desktop.

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
connected to any of that SDK's transports. To serve it from your own HTTP server, `createSeedMcpHttpHandler`
takes the same options plus `allowedOrigins` and `rateLimit`, and returns a web-standard handler:

```ts
import { createSeedMcpHttpHandler } from '@seedprotocol/mcp'

const handle = createSeedMcpHttpHandler({ attesters: ['0xYourPublisherAddress'], rateLimit: 120 })
// For POST, GET, DELETE and OPTIONS on /mcp:
const response = await handle(request, { clientAddress })
```

The rate limit is keyed on `clientAddress`; requests without one are not limited. The handler's
`source: 'local'` reads from a query source registered with `registerLocalQuerySource` instead of
EAS.

On Node, `createSeedMcpHttpServer` from `@seedprotocol/mcp/node` is the `node:http` server `--http` runs. It takes the handler's options plus `path` (default `/mcp`) and `trustProxy`, and returns a server that isn't listening yet:

```ts
import { createSeedMcpHttpServer } from '@seedprotocol/mcp/node'

createSeedMcpHttpServer({ attesters: ['0xYourPublisherAddress'], path: '/seed/mcp', trustProxy: true }).listen(3000)
```

## License

MIT
