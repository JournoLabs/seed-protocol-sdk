import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

function lodashEsUrl() {
  return pathToFileURL(require.resolve('lodash-es')).href
}

function isEasSdkParent(parentURL) {
  return typeof parentURL === 'string' && parentURL.includes('@ethereum-attestation-service/eas-sdk/')
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'lodash' && isEasSdkParent(context.parentURL)) {
    return {
      shortCircuit: true,
      url: lodashEsUrl(),
    }
  }
  return nextResolve(specifier, context)
}
