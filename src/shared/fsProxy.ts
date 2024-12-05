// File: fsProxy.js
let actualFs = {} // Empty placeholder for the real implementation

let resolveFsReady
const fsReady = new Promise((resolve) => {
  resolveFsReady = resolve
})

// Create a proxy object that intercepts all accesses to `fs`
const fsProxy = new Proxy(actualFs, {
  get(target, prop) {
    if (prop.endsWith('Sync')) {
      return (...args) => {
        actualFs[prop](...args)
      }
    }

    return async (...args) => {
      await fsReady
      if (typeof actualFs[prop] === 'function') {
        return actualFs[prop](...args)
      } else {
        return actualFs[prop]
      }
    }
  },
})

const setFsImplementation = (configuredFs) => {
  Object.assign(actualFs, configuredFs)
  resolveFsReady() // Resolve the promise to signal fs is ready
}

export { setFsImplementation }

export default fsProxy
