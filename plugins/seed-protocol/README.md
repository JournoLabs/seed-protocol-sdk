# Seed Protocol plugin for Claude Code

Gives Claude Code read access to content published with Seed Protocol: it lists a publication's items, reads them as Markdown, and shows each item's version history and attestations. The plugin starts the `seed-mcp` server from [`@seedprotocol/mcp`](../../packages/mcp/README.md) and adds the `reading-seed-records` skill, which tells Claude how to read and cite Seed records.

```text
/plugin marketplace add JournoLabs/seed-protocol-sdk
/plugin install seed-protocol@seed-protocol
```

Claude Code asks for two settings at install:

- **Publishers**: comma-separated `0x` attester addresses. When set, the server reads only seeds these addresses attested and refuses any other. When blank, `list_seeds` asks for the publication's address, and the other tools read any seed by UID.
- **Chain ID**: the EAS chain to read. The default, `11155420`, is OP Sepolia.

Change them later with `/plugin configure seed-protocol@seed-protocol`.

The plugin runs the server on your machine with `npx`, so it needs Node.js 20.18.1 or later. For claude.ai, ChatGPT, Claude Desktop and Hermes, see [Use it from an assistant](../../packages/mcp/README.md#use-it-from-an-assistant).
