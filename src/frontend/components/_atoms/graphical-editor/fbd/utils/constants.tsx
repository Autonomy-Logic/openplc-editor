// block

export const DEFAULT_BLOCK_WIDTH = 216
export const DEFAULT_BLOCK_HEIGHT = 128

export const DEFAULT_BLOCK_CONNECTOR_Y = 48
export const DEFAULT_BLOCK_CONNECTOR_Y_OFFSET = 48

export const DEFAULT_BLOCK_TYPE = {
  name: '???',
  type: 'generic',
  variables: [
    { name: '???', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
    { name: '???', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
  ],
  documentation: '',
}

// element

export const MINIMUM_ELEMENT_WIDTH = 144
export const MINIMUM_ELEMENT_HEIGHT = 80

// connection

export const DEFAULT_CONNECTION_WIDTH = 88
export const DEFAULT_CONNECTION_HEIGHT = 32

export const CONNECTION_ELEMENT_WIDTH = 88 + 24
export const CONNECTION_ELEMENT_HEIGHT = 32

export const DEFAULT_CONNECTION_CONNECTOR_X = CONNECTION_ELEMENT_WIDTH
export const DEFAULT_CONNECTION_CONNECTOR_Y = CONNECTION_ELEMENT_HEIGHT / 2

// variable

export const DEFAULT_VARIABLE_WIDTH = 112
export const DEFAULT_VARIABLE_HEIGHT = 32

export const VARIABLE_ELEMENT_SIZE = 128
export const VARIABLE_ELEMENT_HEIGHT = 32

export const DEFAULT_VARIABLE_CONNECTOR_X = DEFAULT_VARIABLE_WIDTH
export const DEFAULT_VARIABLE_CONNECTOR_Y = DEFAULT_VARIABLE_HEIGHT / 2

export { FBD_VARIABLE_NODE_TYPES } from '../../../../../utils/graphical/types'
