import { nativeTheme } from 'electron/main'
import Store from 'electron-store'

// import { DefaultStoreProps, schema } from '../contracts/types/store/schema';
import { TStoreType } from '../../contracts/types/modules/store'

// eslint-disable-next-line import/prefer-default-export
export const store = new Store<TStoreType>({
  schema: {
    last_projects: {
      type: 'array',
      items: {
        type: 'string',
      },
      maxItems: 10,
      uniqueItems: true,
    },
    theme: {
      type: 'string',
    },
    window: {
      type: 'object',
      properties: {
        /**
         * Schema definition for the 'bounds' property within the 'window'.
         */
        bounds: {
          type: 'object',
          properties: {
            /**
             * Schema definition for the 'width' property within the 'bounds'.
             */
            width: {
              type: 'number',
            },
            /**
             * Schema definition for the 'height' property within the 'bounds'.
             */
            height: {
              type: 'number',
            },
            /**
             * Schema definition for the 'x' property within the 'bounds'.
             */
            x: {
              type: 'number',
            },
            /**
             * Schema definition for the 'y' property within the 'bounds'.
             */
            y: {
              type: 'number',
            },
          },
        },
      },
    },
  },
  defaults: {
    last_projects: [],
    theme: 'light',
    window: {
      bounds: {
        width: 1440,
        height: 768,
        x: 0,
        y: 0,
      },
    },
  },
})
