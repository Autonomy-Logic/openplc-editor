import { Schema } from 'electron-store'

import { DefaultStoreProps } from './default'
/**
 * Represents the schema for validating the configuration properties in the store.
 */
export const schema: Schema<DefaultStoreProps> = {
  /**
   * Schema definition for the 'theme' property.
   */
  theme: {
    type: 'string',
  },
  /**
   * Schema definition for the 'window' property.
   */
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
}
