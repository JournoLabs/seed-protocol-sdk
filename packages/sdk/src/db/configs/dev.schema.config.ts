import { defineConfig } from 'drizzle-kit'

// This config is used for tracking schema changes in packages/sdk/src/seedSchema
// It generates migrations in .seed/drizzle-temp, which are then copied to packages/sdk/src/db/drizzle
// Paths are relative to cwd (project root) - the track script runs drizzle-kit with cwd: PROJECT_ROOT

export default defineConfig({
  // Use glob to exclude .d.ts and .d.ts.map (drizzle-kit tries to load them and fails on JSON source maps)
  schema: 'packages/sdk/src/seedSchema/*Schema.ts',
  dialect: 'sqlite',
  out: '.seed/drizzle-temp',
  dbCredentials: {
    url: '.seed/drizzle-state.db',
  },
})
