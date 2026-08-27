/**
 * Default platform entry for TypeScript / Node resolution.
 * Bundlers that honor the "browser" export condition should resolve
 * to index.browser.ts / platform.browser.js instead.
 */
export { createPlatformServices } from './index.node'
export type { PlatformServices } from './types'
export { configurePlatform } from './configurePlatform'
