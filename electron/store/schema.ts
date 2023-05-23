import { Schema } from 'electron-store';

import { DefaultStoreProps } from './default';

export const schema: Schema<DefaultStoreProps> = {
  theme: {
    type: 'string',
  },
  toolbar: {
    type: 'object',
    properties: {
      position: {
        type: 'object',
        properties: {
          x: {
            type: 'number',
          },
          y: {
            type: 'number',
          },
        },
      },
    },
  },
  window: {
    type: 'object',
    properties: {
      bounds: {
        type: 'object',
        properties: {
          width: {
            type: 'number',
          },
          height: {
            type: 'number',
          },
          x: {
            type: 'number',
          },
          y: {
            type: 'number',
          },
        },
      },
    },
  },
};
