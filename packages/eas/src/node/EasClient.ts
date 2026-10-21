import type { Dispatcher } from 'undici'
import { BaseEasClient } from '../EasClient/BaseEasClient.js'
import { DefaultEasClient } from '../default/EasClient.js'
import { createEasNodeDispatcher, type EasNodeDispatcherOptions } from './easDispatcher.js'

export type NodeEasClientOptions = {
  /**
   * Dispatcher for EAS requests. By default an undici `Agent` from
   * {@link createEasNodeDispatcher}, created on first use. Pass your own `Dispatcher`, or
   * `false` to use fetch's global dispatcher.
   */
  dispatcher?: Dispatcher | false
  /** Options for the default dispatcher; ignored when `dispatcher` is given. */
  dispatcherOptions?: EasNodeDispatcherOptions
}

/** {@link DefaultEasClient} whose requests go through a dispatcher tuned for EAS indexers. */
export class NodeEasClient extends DefaultEasClient {
  private dispatcher: Dispatcher | false | undefined

  constructor(private readonly options: NodeEasClientOptions = {}) {
    super()
    this.dispatcher = options.dispatcher
  }

  protected override getDispatcher(): Dispatcher | undefined {
    if (this.dispatcher === undefined) {
      this.dispatcher = createEasNodeDispatcher(this.options.dispatcherOptions) ?? false
    }
    return this.dispatcher || undefined
  }
}

/** @deprecated Prefer NodeEasClient */
export const EasClient = NodeEasClient

BaseEasClient.configure(new NodeEasClient())
