import { BaseArweaveClient } from '../ArweaveClient/BaseArweaveClient.js'
import { DefaultArweaveClient } from '../default/ArweaveClient.js'

export class NodeArweaveClient extends DefaultArweaveClient {}

BaseArweaveClient.configure(new NodeArweaveClient())
