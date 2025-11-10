import { defineConfig } from "drizzle-kit"; export default defineConfig({ schema: "./test-schema", dialect: "sqlite", out: "./test-db", dbCredentials: { url: "./test-db/test.sqlite3" } });
