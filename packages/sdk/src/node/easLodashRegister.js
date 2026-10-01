/**
 * Node loader entry for `@seedprotocol/sdk/node-eas-lodash`.
 *
 * eas-sdk 2.10 ESM does `import { isEqual } from 'lodash'`. `lodash` is CommonJS;
 * Node rejects that named import. `lodash-es` is the ESM build (already a dependency
 * of this package) and does support named imports. The hook sends only eas-sdk's
 * `lodash` specifier to `lodash-es`.
 *
 *   node --import @seedprotocol/sdk/node-eas-lodash
 */
import { register } from 'node:module'

register('./easLodashHook.js', import.meta.url)
