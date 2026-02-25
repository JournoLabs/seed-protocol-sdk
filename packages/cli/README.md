# @seedprotocol/cli

CLI tool for Seed Protocol. This package can be used independently via `npx @seedprotocol/cli` or installed as a dependency.

## Installation

```bash
npm install -g @seedprotocol/cli
# or
npx @seedprotocol/cli
```

## Usage

### Initialize a Seed Protocol project

```bash
npx @seedprotocol/cli init [schemaPath] [appFilesPath]
```

### Seed the database

```bash
npx @seedprotocol/cli seed [seedDataPath]
```

### Add a model

```bash
npx @seedprotocol/cli add-model <source-schema-file-path> <output-file-path> <json-string>
```

### Start RPC server

```bash
npx @seedprotocol/cli rpc-server
```

## Development

This package shares code with `@seedprotocol/sdk` and is built as part of the monorepo workspace.

```bash
# Build the CLI package
npm run build:cli

# Build both SDK and CLI
npm run build:all
```

