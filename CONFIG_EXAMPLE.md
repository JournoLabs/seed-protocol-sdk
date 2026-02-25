# Configuration Example for Seed Protocol SDK

After removing the config files, SDK users need to pass configuration values when initializing the client. Here are examples of how to do this:

## Current Implementation

The SDK currently accepts configuration through `ClientManager.init()`. Here's the basic structure:

```typescript
import { ClientManager } from '@seedprotocol/sdk'

await ClientManager.init({
  config: {
    endpoints: {
      // Your EAS endpoint configuration
    },
    models: {
      // Your model definitions
    },
    filesDir: '.seed' // Directory where .seed data is stored
  },
  addresses: ['0x...'] // Ethereum addresses
})
```

## Schema File

You can load a schema from a JSON file on init by passing `schemaFile`:

```typescript
await ClientManager.init({
  config: {
    endpoints: { filePaths: '...', files: '.seed' },
    filesDir: '.seed',
    schemaFile: 'schema.json',  // Path relative to project root (Node) or working dir (browser)
  },
  addresses: [],
})
```

- **Supported formats:** Minimal (`{ "name": "MySchema", "models": { ... } }`) or complete (`{ "$schema": "...", "metadata": { "name": "MySchema" }, "models": { ... } }`)
- **Path resolution:** Node = relative to `process.cwd()`; Browser = relative to working dir (OPFS)
- **Idempotent:** If the schema already exists in the database, it will not create duplicates

## Database Configuration

To customize database settings, you'll need to pass a `dbConfig` object. The `DbConfig` interface supports:

```typescript
interface DbConfig {
  dbUrl?: string      // Database URL (defaults to `${filesDir}/db/seed.db`)
  schemaDir?: string  // Schema directory (defaults to `${filesDir}/schema`)
  outDir?: string     // Output directory for migrations (defaults to `${filesDir}/db`)
}
```

### Example: Custom Database Path

```typescript
import { ClientManager } from '@seedprotocol/sdk'

await ClientManager.init({
  config: {
    endpoints: {
      eas: 'https://your-eas-endpoint.com'
    },
    models: {
      Post: PostModel,
      User: UserModel
    },
    filesDir: '.seed',
    // Database configuration
    dbConfig: {
      dbUrl: '/custom/path/to/database.db',
      schemaDir: '.seed/schema',
      outDir: '.seed/db'
    }
  },
  addresses: ['0x1234...', '0x5678...']
})
```

### Example: Using File URLs (for libsql)

```typescript
await ClientManager.init({
  config: {
    endpoints: { /* ... */ },
    models: { /* ... */ },
    filesDir: '.seed',
    dbConfig: {
      dbUrl: 'file:/absolute/path/to/database.db'
    }
  },
  addresses: ['0x...']
})
```

### Example: Minimal Configuration (uses defaults)

```typescript
await ClientManager.init({
  config: {
    endpoints: { /* ... */ },
    models: { /* ... */ },
    filesDir: '.seed'
    // dbConfig is optional - defaults will be used:
    // - dbUrl: `${filesDir}/db/seed.db`
    // - schemaDir: `${filesDir}/schema`
    // - outDir: `${filesDir}/db`
  },
  addresses: ['0x...']
})
```

## Node.js Specific: Using getAppDb()

If you need to access the database directly in Node.js, you can use `getAppDb()` with configuration:

```typescript
import { getAppDb } from '@seedprotocol/sdk/node'

// Must provide dbUrl when calling getAppDb
const db = getAppDb({
  dbUrl: '.seed/db/seed.db' // or 'file:.seed/db/seed.db'
})
```

## Browser Environment

In browser environments, the database is automatically configured using OPFS (Origin Private File System). The `filesDir` option still applies, but database paths are handled internally.

```typescript
// Browser - same API, but dbConfig.dbUrl is not used
await ClientManager.init({
  config: {
    endpoints: { /* ... */ },
    models: { /* ... */ },
    filesDir: '.seed' // Virtual path in OPFS
  },
  addresses: ['0x...']
})
```

## Migration from Config Files

If you were previously using config files (which have been removed from the SDK), here's how to migrate:

### Before (using config files):
```typescript
// Config was automatically loaded from SDK internal config files
await ClientManager.init({
  config: { /* ... */ },
  addresses: ['0x...']
})
```

### After (manual configuration):
```typescript
await ClientManager.init({
  config: {
    // ... your existing config
    filesDir: '.seed',
    dbConfig: {
      dbUrl: '.seed/db/seed.db',      // Previously: `${dotSeedDir}/db/seed.db`
      schemaDir: '.seed/schema',      // Previously: `${dotSeedDir}/schema`
      outDir: '.seed/db'               // Previously: `${dotSeedDir}/db`
    }
  },
  addresses: ['0x...']
})
```

## Notes

- All `dbConfig` properties are optional. If not provided, sensible defaults are used based on `filesDir`.
- The `dbUrl` can be a relative path or a `file:` URL.
- The SDK will create directories automatically if they don't exist.
- For production deployments, use absolute paths for `dbUrl` to avoid path resolution issues.

