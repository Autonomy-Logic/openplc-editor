import { Schema } from 'electron-store';

import { DefaultStoreProps } from './default';

export const schema: Schema<DefaultStoreProps> = {
  theme: {
    type: 'string',
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
