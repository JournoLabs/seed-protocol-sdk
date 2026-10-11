import { BaseQueryClient } from '../QueryClient/BaseQueryClient.js'
import { DefaultQueryClient } from '../default/QueryClient.js'

export class NodeQueryClient extends DefaultQueryClient {}

/** @deprecated Prefer NodeQueryClient */
export const QueryClient = NodeQueryClient

BaseQueryClient.configure(new NodeQueryClient())
