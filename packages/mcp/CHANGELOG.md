# Changelog

All notable changes to this package are documented in this file.

## Unreleased

- First version. `seed-mcp` runs an MCP server on stdio with four read-only tools over published Seed Protocol content: `list_seeds`, `get_seed`, `get_changelog` and `get_provenance`. `--attester` (or `SEED_MCP_ATTESTERS`) limits it to a publication's attesters. `createSeedMcpServer` builds the same server for any MCP transport.
