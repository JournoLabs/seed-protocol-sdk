import config from '../__tests__/__mocks__/project/schema'
import { client as seedClient } from '../src'

const addresses = process.env.PERSONAL_WALLET_ADDRESSES

seedClient.init({ config, addresses })

export const getClient = () => seedClient
