import Store from 'electron-store';

import { DefaultStore, getDefaultStore } from './default';
import { schema } from './schema';

export const store = new Store<DefaultStore>({
  defaults: getDefaultStore(),
  clearInvalidConfig: true,
  schema,
});
