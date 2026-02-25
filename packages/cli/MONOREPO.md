# Monorepo Package Management

This document describes how the `@seedprotocol/sdk` and `@seedprotocol/cli` packages are managed in this monorepo.

## Package Structure

- **`@seedprotocol/sdk`** (root): The main SDK package
- **`@seedprotocol/cli`** (`packages/cli/`): The CLI tool package

## Version Synchronization

Both packages **must** have identical version numbers to ensure compatibility. The CLI depends on the SDK and uses the same version to guarantee API compatibility.

### Automatic Version Sync

Version synchronization is handled automatically:

1. **During Development**: The `sync-versions` script ensures versions match
2. **Before Publishing**: The `prepublishOnly` hook syncs versions and updates the SDK dependency
3. **Using npm version**: The `version` script hook automatically syncs versions when you run `npm version`

### Manual Version Sync

To manually sync versions:

```bash
npm run sync-versions
```

To set a specific version:

```bash
node scripts/sync-versions.js 1.2.3
```

## Shared Code Strategy

### Best Practices

1. **SDK as Source of Truth**: The SDK contains all shared business logic
2. **CLI Imports from SDK**: The CLI imports and uses SDK exports via `@seedprotocol/sdk`
3. **No Code Duplication**: Shared utilities, types, and functions live in the SDK
4. **Local Development**: CLI uses `file:../../` protocol for local SDK dependency
5. **Published Packages**: CLI uses exact version matching (e.g., `^0.3.32`) when published

### Dependency Management

**Local Development** (`packages/cli/package.json`):
```json
{
  "dependencies": {
    "@seedprotocol/sdk": "file:../../"
  }
}
```

**Published Package** (updated in `prepublishOnly`):
```json
{
  "dependencies": {
    "@seedprotocol/sdk": "^0.3.32"
  }
}
```

The `prepublishOnly` script automatically updates the SDK dependency version to match the CLI version before publishing.

## Building Packages

### Build SDK Only
```bash
npm run build
```

### Build CLI Only
```bash
npm run build:cli
```

### Build Both
```bash
npm run build:all
```

This command:
1. Syncs versions
2. Builds the SDK
3. Builds the CLI

## Publishing

### Publishing SDK
```bash
npm run build:publish
```

This will:
1. Sync versions
2. Build the SDK
3. Publish to npm

### Publishing CLI
```bash
cd packages/cli
npm publish
```

The `prepublishOnly` hook will:
1. Build the CLI
2. Sync versions
3. Update the SDK dependency to match the CLI version

### Publishing Both

To publish both packages with synchronized versions:

```bash
# 1. Sync versions
npm run sync-versions

# 2. Build both
npm run build:all

# 3. Publish SDK
npm publish

# 4. Publish CLI
cd packages/cli && npm publish
```

## Workspace Configuration

The monorepo uses npm workspaces (defined in root `package.json`):

```json
{
  "workspaces": [
    "packages/*"
  ]
}
```

This allows:
- Local package linking during development
- Shared `node_modules` for common dependencies
- Workspace protocol (`file:../../`) for local dependencies

## Adding Shared Code

When adding functionality that both SDK and CLI need:

1. **Add to SDK**: Place the code in the appropriate SDK module
2. **Export from SDK**: Ensure it's exported from `src/index.ts` or `src/node/index.ts`
3. **Import in CLI**: Import using `import { ... } from '@seedprotocol/sdk'`
4. **Update Types**: Ensure TypeScript types are properly exported

### Example

**SDK** (`src/helpers/myHelper.ts`):
```typescript
export const myHelper = () => {
  // Shared logic
}
```

**CLI** (`packages/cli/src/bin.ts`):
```typescript
import { myHelper } from '@seedprotocol/sdk'
```

## Testing

Tests can import from either package:

- SDK tests: Use `@/` path aliases to import from SDK source
- CLI tests: Import from `@seedprotocol/sdk` (as published package would)

## Version Bumping

When bumping versions, use npm's version command which will trigger the sync:

```bash
npm version patch  # 0.3.32 -> 0.3.33
npm version minor  # 0.3.32 -> 0.4.0
npm version major  # 0.3.32 -> 1.0.0
```

This automatically:
1. Updates root `package.json` version
2. Triggers `version` script (which syncs versions)
3. Creates a git commit and tag

## Troubleshooting

### Versions Out of Sync

If versions get out of sync:

```bash
npm run sync-versions
```

### CLI Can't Find SDK

During development, ensure you've installed dependencies:

```bash
npm install
```

This will link the local SDK to the CLI via the workspace protocol.

### Build Errors

If you get import errors, ensure:
1. SDK is built: `npm run build`
2. CLI can resolve SDK: Check `packages/cli/node_modules/@seedprotocol/sdk` exists or is linked
3. TypeScript paths are correct: Check `tsconfig.json` in both packages

