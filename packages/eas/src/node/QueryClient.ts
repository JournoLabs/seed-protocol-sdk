import { BaseQueryClient } from '../QueryClient/BaseQueryClient.js'
import { DefaultQueryClient } from '../default/QueryClient.js'

export class NodeQueryClient extends DefaultQueryClient {}

BaseQueryClient.configure(new NodeQueryClient())
