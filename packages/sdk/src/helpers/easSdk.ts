import { isNode } from '@/helpers/environment'

type EasSdk = typeof import('@ethereum-attestation-service/eas-sdk')

let easSdkPromise: Promise<EasSdk> | undefined

/**
 * Load eas-sdk on first use instead of at SDK import time.
 *
 * On Node this loads eas-sdk's CommonJS build. Its ESM build (2.9.1+) does
 * `import { isEqual } from 'lodash'`, which Node rejects because lodash is
 * CommonJS, so a static import made `import '@seedprotocol/sdk'` fail unless the
 * app ran with `--import @seedprotocol/sdk/node-eas-lodash`.
 *
 * `process.getBuiltinModule` (Node 20.16+, 22.3+) keeps `node:module` out of the
 * import graph, so browser bundlers never see it. Bundlers resolve the
 * `import()` branch, and handle lodash there themselves.
 */
export function loadEasSdk(): Promise<EasSdk> {
  if (!easSdkPromise) {
    easSdkPromise = (async () => {
      if (isNode() && typeof document === 'undefined' && typeof process.getBuiltinModule === 'function') {
        try {
          const { createRequire } = process.getBuiltinModule('node:module')
          return createRequire(import.meta.url)('@ethereum-attestation-service/eas-sdk') as EasSdk
        } catch {
          // e.g. import.meta.url is not a file: URL (bundled renderer). Fall through.
        }
      }
      return import('@ethereum-attestation-service/eas-sdk')
    })()
    easSdkPromise.catch(() => {
      easSdkPromise = undefined
    })
  }
  return easSdkPromise
}
