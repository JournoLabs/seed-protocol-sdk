# Monorepo Migration Summary

This document summarizes the changes made to properly separate the CLI into its own package (`@seedprotocol/cli`) while maintaining code sharing with the SDK.

## Changes Made

### 1. Version Synchronization

**Created**: `scripts/sync-versions.js`
- Ensures SDK and CLI packages always have matching versions
- Can be run manually: `npm run sync-versions`
- Automatically runs during `npm version` command
- Automatically runs before publishing

**Updated**: `package.json`
- Added `sync-versions` script
- Added `version` script hook to auto-sync on version bump
- Updated `build:all` to sync versions before building
- Updated `build:publish` to sync versions before publishing

**Updated**: `packages/cli/package.json`
- Updated `prepublishOnly` to dynamically read SDK version and update dependency
- Ensures published CLI always references the correct SDK version

### 2. Package Structure

**CLI Package** (`packages/cli/`):
- Independent package with its own `package.json`
- Uses `@seedprotocol/sdk` as a dependency
- Local development: Uses `file:../../` workspace protocol
- Published: Uses exact version matching (e.g., `^0.3.32`)

**SDK Package** (root):
- Removed CLI-related build configurations
- No longer includes CLI in its build output
- Exports remain the same for consumers

### 3. Code Sharing Strategy

**Best Practice**: SDK as Single Source of Truth
- All shared business logic lives in the SDK
- CLI imports from SDK: `import { ... } from '@seedprotocol/sdk'`
- No code duplication between packages
- Shared utilities, types, and functions are in SDK

**Examples**:
- `PathResolver`, `commandExists`, `createDrizzleSchemaFilesFromConfig` - all in SDK
- CLI imports these from SDK
- CLI-specific code (Commander.js setup, CLI commands) stays in CLI package

### 4. Updated References

**Test Files**:
- `__tests__/node/client.test.ts`: Now directly calls CLI from `packages/cli/src/bin.ts`
- `__tests__/__fixtures__/scripts.ts`: Updated to use new CLI path

**Build Configurations**:
- `vite.config.js`: Removed references to `scripts/bin.ts`
- `packages/cli/src/bin.ts`: Removed check for old `scripts/bin.ts` path

**Helper Functions**:
- `src/node/helpers/scripts.ts`: Already correctly references `@seedprotocol/cli`

### 5. Documentation

**Created**: `packages/cli/MONOREPO.md`
- Comprehensive guide on monorepo package management
- Version synchronization process
- Code sharing best practices
- Build and publish procedures
- Troubleshooting guide

## Version Synchronization

### How It Works

1. **SDK is Source of Truth**: The SDK's version in root `package.json` is the authoritative version
2. **Automatic Sync**: The `sync-versions` script reads SDK version and updates CLI version
3. **Before Publish**: `prepublishOnly` hook ensures versions match and updates SDK dependency

### Manual Sync

```bash
# Sync to current SDK version
npm run sync-versions

# Set specific version
node scripts/sync-versions.js 1.2.3
```

### Automatic Sync

- `npm version patch|minor|major` - Automatically syncs versions
- `npm run build:all` - Syncs before building
- `npm run build:publish` - Syncs before publishing
- `cd packages/cli && npm publish` - Syncs in `prepublishOnly` hook

## Publishing Workflow

### Publishing SDK

```bash
npm run build:publish
```

This will:
1. Sync versions
2. Build SDK
3. Publish to npm

### Publishing CLI

```bash
cd packages/cli
npm publish
```

This will (via `prepublishOnly`):
1. Build CLI
2. Sync versions
3. Update SDK dependency to match CLI version
4. Publish to npm

### Publishing Both

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

## Benefits

1. **Independent Versioning**: CLI can theoretically be versioned independently (though we keep them in sync for compatibility)
2. **Clear Dependencies**: CLI's dependency on SDK is explicit
3. **Better Separation**: CLI-specific code is isolated
4. **Easier Testing**: Can test CLI as a separate package
5. **Cleaner Builds**: SDK build no longer includes CLI code
6. **Workspace Benefits**: Local development uses workspace protocol for fast iteration

## Migration Checklist

- [x] Create version sync script
- [x] Update package.json scripts
- [x] Update CLI prepublishOnly hook
- [x] Update test files to use new CLI path
- [x] Remove old CLI references from build configs
- [x] Update CLI bin.ts to remove old path checks
- [x] Create monorepo documentation
- [x] Test version synchronization

## Future Improvements

1. **Automated Testing**: Add CI checks to ensure versions stay in sync
2. **Changelog Sync**: Consider syncing changelogs between packages
3. **Release Automation**: Consider using a tool like `changesets` or `lerna` for coordinated releases
4. **Type Safety**: Ensure TypeScript properly resolves SDK types in CLI

## Questions?

See `packages/cli/MONOREPO.md` for detailed documentation on:
- How to add shared code
- Troubleshooting version sync issues
- Build and test procedures
- Workspace configuration

