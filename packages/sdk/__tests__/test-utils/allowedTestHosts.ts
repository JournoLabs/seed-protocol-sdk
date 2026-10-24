/**
 * External hosts tests may reach (networkGuard.ts); every other non-local host is blocked. Each
 * entry says why the tests need the real service. A host goes on this list only when mocking it
 * at the network boundary would test less than calling it, and its answers are stable enough not
 * to flake. vite.config.js exempts these hosts from the browser's DNS block too.
 *
 * Plain TypeScript (no enums or other non-erasable syntax): vite.config.js imports it.
 */
export const ALLOWED_TEST_HOSTS: Readonly<Record<string, string>> = {
  // The SDK's default EAS indexer (EAS_ENDPOINT in @seedprotocol/eas). Item saves and model init
  // look up property and model schemas there, and those lookups run in most SDK tests.
  'optimism-sepolia.easscan.org': 'default EAS indexer: schema lookups on save and init',
}
