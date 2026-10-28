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
  private dispatcher: Promise<Dispatcher | undefined> | undefined

  constructor(private readonly options: NodeEasClientOptions = {}) {
    super()
  }

  /** Created once, on first use; each request awaits it before calling fetch. */
  protected override getDispatcher(): Promise<Dispatcher | undefined> {
    const { dispatcher, dispatcherOptions } = this.options
    this.dispatcher ??=
      dispatcher === undefined ? createEasNodeDispatcher(dispatcherOptions) : Promise.resolve(dispatcher || undefined)
    return this.dispatcher
  }
}

BaseEasClient.configure(new NodeEasClient())
