import Store from 'electron-store'

import { DefaultStoreProps, getDefaultStore } from './default'
import { schema } from './schema'

/**
 * Represents an instance of the Electron Store for application settings.
 */
export const store = new Store<DefaultStoreProps>({
  /**
   * Default values for the store properties, obtained from the `getDefaultStore` function.
   */
  defaults: getDefaultStore(),
  /**
   * Determines whether invalid configuration entries should be cleared automatically.
   */
  clearInvalidConfig: true,
  /**
   * Defines the schema used to validate the configuration entries.
   */
  schema,
})
