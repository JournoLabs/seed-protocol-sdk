import { ARWEAVE_HOST } from '@/client/constants'
import { BaseArweaveClient } from './BaseArweaveClient'
import Arweave from 'arweave'
import { isBrowser } from '../environment'

let ArweaveClient: typeof BaseArweaveClient | undefined

export const initArweaveClient = async () => {
  if (isBrowser()) {
    ArweaveClient = (await import('../../browser/helpers/ArweaveClient')).ArweaveClient
  }

  // if (!isBrowser()) {
  //   ArweaveClient = (await import('../../node/helpers/ArweaveClient')).ArweaveClient
  // }
}


let domain = 'arweave.net'
let domainExplicitlySet = false

export const getArweave = (): Arweave | undefined => {
  if (
    typeof window === 'undefined' ||
    !Arweave ||
    (!Object.keys(Arweave).includes('init') &&
      !Object.keys(Arweave).includes('default'))
  ) {
    return
  }

  // Use the domain variable if it was explicitly set, otherwise use ARWEAVE_HOST in production
  const hostToUse = domainExplicitlySet ? domain : ARWEAVE_HOST

  if (process.env.NODE_ENV === 'production') {
    if (Object.keys(Arweave).includes('default')) {
      return Arweave.default.init({
        host: hostToUse,
        protocol: 'https',
      })
    }

    return Arweave.init({
      host: hostToUse,
      protocol: 'https',
    })
  }

  // return Arweave.init({
  //   host     : 'localhost',
  //   port     : 1984,
  //   protocol : 'http',
  // },)

  if (Object.keys(Arweave).includes('default')) {
    return Arweave.default.init({
      host: domain,
      protocol: 'https',
    })
  }

  return Arweave.init({
    host: domain,
    protocol: 'https',
  })
}

export const setArweaveDomain = (newDomain: string): void => {
  domain = newDomain
  domainExplicitlySet = true
}

export const getArweaveDomain = (): string => {
  // If domain was explicitly set via setArweaveDomain (from user config), use it
  // Otherwise, in production use ARWEAVE_HOST from env/constants
  // In non-production, use the domain variable (defaults to 'arweave.net')
  if (domainExplicitlySet) {
    return domain
  }
  
  if (process.env.NODE_ENV === 'production') {
    return ARWEAVE_HOST
  }
  
  return domain
}

export { ArweaveClient }