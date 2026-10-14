/**
 * Node loader entry for `@seedprotocol/sdk/node-eas-lodash`.
 *
 * eas-sdk 2.10 ESM does `import { isEqual } from 'lodash'`. `lodash` is CommonJS;
 * Node rejects that named import. `lodash-es` is the ESM build (already a dependency
 * of this package) and does support named imports. The hook sends only eas-sdk's
 * `lodash` specifier to `lodash-es`.
 *
 * `@seedprotocol/sdk` itself no longer needs this: it loads eas-sdk's CommonJS
 * build on Node (see src/helpers/easSdk.ts). `@seedprotocol/publish` imports
 * eas-sdk statically, so Node processes that load it still need the hook.
 *
 *   node --import @seedprotocol/sdk/node-eas-lodash
 */
import { register } from 'node:module'

register('./easLodashHook.js', import.meta.url)
