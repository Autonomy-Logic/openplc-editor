import { TStoreType } from '@root/backend/editor/contracts/types/modules/store'
import Store from 'electron-store'

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
    /**
     * The Edge session. Declared so `electron-store` validates what it writes, but
     * deliberately absent from `defaults`: no key at all is the signed-out state, and
     * a default would make "never signed in" indistinguishable from "signed out".
     *
     * The value is a base64 `safeStorage` ciphertext, not the token itself.
     */
    edge_session: {
      type: 'object',
      properties: {
        refreshToken: {
          type: 'string',
        },
      },
      required: ['refreshToken'],
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
