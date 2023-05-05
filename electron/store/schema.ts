import { Schema } from 'electron-store';

import { DefaultStore } from './default';

export const schema: Schema<DefaultStore> = {
  theme: {
    type: 'string',
  },
  toolbar: {
    type: 'object',
    properties: {
      position: {
        type: 'number',
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
