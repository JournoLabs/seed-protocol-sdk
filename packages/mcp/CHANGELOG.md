# Changelog

All notable changes to this package are documented in this file.

## 0.8.3 (2026-11-23)

- First version. `seed-mcp` runs an MCP server on stdio with four read-only tools over published Seed Protocol content: `list_seeds`, `get_seed`, `get_changelog` and `get_provenance`. `--attester` (or `SEED_MCP_ATTESTERS`) limits it to a publication's attesters. `createSeedMcpServer` builds the same server for any MCP transport.
- `seed-mcp --http` serves the same tools over Streamable HTTP at `/mcp`, for hosted connectors such as claude.ai and ChatGPT. It is stateless, answers with JSON, refuses browser origins not given with `--allowed-origin`, and limits each client address to `--rate-limit` requests per minute (default 120). `createSeedMcpHttpHandler` is the same endpoint as a web-standard `(Request) => Promise<Response>` handler for any HTTP server.
- A Claude Code plugin in `plugins/seed-protocol/`, installed with `/plugin marketplace add JournoLabs/seed-protocol-sdk` and `/plugin install seed-protocol@seed-protocol`, starts this server and adds the `reading-seed-records` skill, which tells an agent how to read and cite Seed records. The README covers Claude Desktop, Hermes, claude.ai and ChatGPT.

### Commits

#### Features

- serve the read-only tools over Streamable HTTP (ae7313de)
- read-only MCP server over published Seed content (bdbbbd6c)

#### Other

- install the Seed MCP server in Claude, Hermes, claude.ai and ChatGPT (6ae49f7d)
