import 'arweave/bundles/web.bundle.js'

const ArweaveFromGlobal = globalThis.Arweave

export default ArweaveFromGlobal
export const init = (...args) => ArweaveFromGlobal?.init?.(...args)
