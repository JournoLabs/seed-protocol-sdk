import { defineConfig } from 'drizzle-kit'

// drizzle-kit config for the SDK's migrations, used by scripts/update-drizzle.ts (`bun run
// drizzle:update`). Generates straight into the committed migration folder, diffing the schema
// against its newest snapshot. Paths are relative to the repo root (the script's cwd).
export default defineConfig({
  // The glob skips .d.ts / .d.ts.map files, which drizzle-kit fails to load.
  schema: 'packages/sdk/src/seedSchema/*Schema.ts',
  dialect: 'sqlite',
  out: 'packages/sdk/src/db/drizzle',
})
