/**
 * `seed-gateway serve|connect` — HTTP tunnel to Seed gateway + upload API infrastructure over HyperDHT.
 * Run under Node (Holepunch natives may crash under Bun).
 */
import process from 'node:process'
import { main } from './cli'

main(process.argv.slice(2)).catch((err) => {
  console.error('[Seed Protocol]', err instanceof Error ? err.message : err)
  process.exit(1)
})
