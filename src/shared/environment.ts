export const isNode = (): boolean => {
  return (
    typeof process !== 'undefined' &&
    process.versions != null &&
    process.versions.node != null
  )
}

export const isBrowser = (): boolean => {
  return typeof window !== 'undefined' && typeof window.document !== 'undefined'
}

export const isReactNative = (): boolean => {
  return typeof navigator !== 'undefined' && navigator.product === 'ReactNative'
}
