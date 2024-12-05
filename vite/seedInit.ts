import config from '../__tests__/__mocks__/project/schema'
import { client as seedClient } from '../src'

const addresses = import.meta.env.VITE_PERSONAL_WALLET_ADDRESSES.split(',')

seedClient.init({ config, addresses })

export const getClient = () => seedClient
