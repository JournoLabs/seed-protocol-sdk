import { ARWEAVE_HOST } from '@/services/internal/constants'
import { BaseArweaveClient } from './BaseArweaveClient'
import Arweave from 'arweave'
import { isBrowser } from '../environment'

let ArweaveClient: typeof BaseArweaveClient | undefined

export const initArweaveClient = async () => {
  if (isBrowser()) {
    ArweaveClient = (await import('../../browser/helpers/ArweaveClient')).ArweaveClient
  }

  if (!isBrowser()) {
    ArweaveClient = (await import('../../node/helpers/ArweaveClient')).ArweaveClient
  }
}


let domain = 'arweave.net'

export const getArweave = (): Arweave | undefined => {
  if (
    typeof window === 'undefined' ||
    !Arweave ||
    (!Object.keys(Arweave).includes('init') &&
      !Object.keys(Arweave).includes('default'))
  ) {
    return
  }

  if (process.env.NODE_ENV === 'production') {
    if (Object.keys(Arweave).includes('default')) {
      return Arweave.default.init({
        host: ARWEAVE_HOST,
        protocol: 'https',
      })
    }

    return Arweave.init({
      host: ARWEAVE_HOST,
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
}

export { ArweaveClient }