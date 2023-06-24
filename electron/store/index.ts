import Store from 'electron-store'

import { DefaultStoreProps, getDefaultStore } from './default'
import { schema } from './schema'

export const store = new Store<DefaultStoreProps>({
  defaults: getDefaultStore(),
  clearInvalidConfig: true,
  schema,
})
