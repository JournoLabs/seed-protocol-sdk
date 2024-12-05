import Arweave from 'arweave'

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
    return Arweave.init({
      host: process.env.NEXT_PUBLIC_ARWEAVE_HOST,
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
      host: 'permagate.io',
      protocol: 'https',
    })
  }

  return Arweave.init({
    host: 'permagate.io',
    protocol: 'https',
  })
}
