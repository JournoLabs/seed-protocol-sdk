import { BaseArweaveClient } from '../ArweaveClient/BaseArweaveClient.js'
import { DefaultArweaveClient } from '../default/ArweaveClient.js'

export class NodeArweaveClient extends DefaultArweaveClient {}

/** @deprecated Prefer NodeArweaveClient */
export const ArweaveClient = NodeArweaveClient

BaseArweaveClient.configure(new NodeArweaveClient())
