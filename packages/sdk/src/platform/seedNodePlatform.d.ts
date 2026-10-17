/**
 * `#seed-node-platform` is a package.json `imports` entry: dist/platform.node.js, except under
 * the `browser` condition, where it maps to dist/platform.browser.js. platformClassesInit only
 * imports it outside the browser, so the mapping exists to keep the Node platform (libsql,
 * node:fs) out of browser bundles. Tests alias it to the matching source.
 */
declare module '#seed-node-platform' {
  import type { PlatformServices } from '@/platform/types'
  export function createPlatformServices(): PlatformServices
}
