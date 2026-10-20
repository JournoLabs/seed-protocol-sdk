// Started from a worker by nestedWorkerShim.test.ts. Reports the URL it runs at and, when asked,
// whether a root-relative importScripts call loaded the helper next to it.
self.onmessage = (event) => {
  const importPath = event.data && event.data.importPath
  if (importPath) importScripts(importPath)
  self.postMessage({ href: self.location.href, helperLoaded: self.__seedNestedHelperLoaded === true })
}
