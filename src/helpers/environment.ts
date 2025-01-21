export const isNode = (): boolean => {
  return (
    typeof process !== 'undefined' &&
    process.versions != null &&
    process.versions.node != null
  )
}

export const isBrowser = (): boolean => {
  return !isElectron() && typeof window !== 'undefined' && typeof window.document !== 'undefined'
}

export const isReactNative = (): boolean => {
  return typeof navigator !== 'undefined' && navigator.product === 'ReactNative'
}

export const isElectron = (): boolean => {
  return typeof process !== 'undefined' && process.versions != null && process.versions.electron != null;
}

export const getEnvironment = (): string => {
  if (isBrowser()) {
    return 'browser'
  }

  if (isElectron()) {
    return 'electron'
  }

  if (isReactNative()) {
    return 'react-native'
  }

  return 'node'
}
