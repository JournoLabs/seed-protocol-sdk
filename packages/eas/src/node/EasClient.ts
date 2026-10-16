import { BaseEasClient } from '../EasClient/BaseEasClient.js'
import { DefaultEasClient } from '../default/EasClient.js'

export class NodeEasClient extends DefaultEasClient {}

/** @deprecated Prefer NodeEasClient */
export const EasClient = NodeEasClient

BaseEasClient.configure(new NodeEasClient())
