import Store from 'electron-store';

import {
  DefaultStoreProps,
  getDefaultStore,
  schema,
} from '../contracts/types/store/schema';

// eslint-disable-next-line import/prefer-default-export
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
});

export type StoreType = typeof store;
