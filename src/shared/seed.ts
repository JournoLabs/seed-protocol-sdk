import { isBrowser, isNode, isReactNative } from '@/shared/environment'
import { Endpoints, SeedConstructorOptions } from '@/types/types'
import { Subject } from 'rxjs'

type Environment = 'node' | 'browser' | 'react-native'

abstract class SeedBase {
  private readonly _env: Environment = 'browser'
  protected _subject: Subject<void> = new Subject<void>()

  constructor(props: { endpoints: Endpoints }) {
    console.log('Seed constructor called')
    if (isNode()) {
      this._env = 'node'
    }
    if (isBrowser()) {
      this._env = 'browser'
    }
    if (isReactNative()) {
      this._env = 'react-native'
    }
  }

  async initialize() {}

  subscribe(callback: (event: any) => void) {
    return this._subject.subscribe(callback)
  }
}

class SeedSync extends SeedBase {
  constructor(props: SeedConstructorOptions) {
    super(props)
  }
}

export { SeedBase, SeedSync }
