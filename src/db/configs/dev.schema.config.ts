import { defineConfig } from 'drizzle-kit'

// This config is used for tracking schema changes in src/seedSchema
// It generates migrations in .seed/drizzle-temp, which are then copied to src/db/drizzle
// Using relative paths to avoid path resolution issues with drizzle-kit

export default defineConfig({
  schema: './src/seedSchema',
  dialect: 'sqlite',
  out: './.seed/drizzle-temp',
  dbCredentials: {
    url: './.seed/drizzle-state.db',
  },
})
