import { ReactNode } from 'react'

import {
  DefaultCoil,
  FallingEdgeCoil,
  NegatedCoil,
  ResetCoil,
  RisingEdgeCoil,
  SetCoil,
} from '../../../../../assets/icons/flow/Coil'
import {
  DefaultContact,
  FallingEdgeContact,
  NegatedContact,
  RisingEdgeContact,
} from '../../../../../assets/icons/flow/Contact'
import { cn } from '../../../../../utils/cn'
import { CoilType, ContactType } from './types'

// block

export const DEFAULT_BLOCK_WIDTH = 216
export const DEFAULT_BLOCK_HEIGHT = 128

export const DEFAULT_BLOCK_CONNECTOR_Y = 36
export const DEFAULT_BLOCK_CONNECTOR_Y_OFFSET = 40

export const DEFAULT_BLOCK_TYPE = {
  name: '???',
  type: 'generic',
  variables: [
    { name: '???', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
    { name: '???', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
  ],
  documentation: '',
}

// coil

export const DEFAULT_COIL_BLOCK_WIDTH = 28
export const DEFAULT_COIL_BLOCK_HEIGHT = 24

export const DEFAULT_COIL_CONNECTOR_X = DEFAULT_COIL_BLOCK_WIDTH
export const DEFAULT_COIL_CONNECTOR_Y = DEFAULT_COIL_BLOCK_HEIGHT / 2

export const DEFAULT_COIL_TYPES: CoilType = {
  default: {
    svg: (wrongVariable, debuggerColor) => (
      <DefaultCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName={cn('fill-neutral-1000 dark:fill-neutral-100', {
          'fill-red-500 dark:fill-red-500': wrongVariable,
        })}
        parenthesesColor={debuggerColor}
      />
    ),
  },
  negated: {
    svg: (wrongVariable, debuggerColor) => (
      <NegatedCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName={cn('fill-neutral-1000 dark:fill-neutral-100', {
          'fill-red-500 dark:fill-red-500': wrongVariable,
        })}
        parenthesesColor={debuggerColor}
      />
    ),
  },
  risingEdge: {
    svg: (wrongVariable, debuggerColor) => (
      <RisingEdgeCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName={cn('fill-neutral-1000 dark:fill-neutral-100', {
          'fill-red-500 dark:fill-red-500': wrongVariable,
        })}
        parenthesesColor={debuggerColor}
      />
    ),
  },
  fallingEdge: {
    svg: (wrongVariable, debuggerColor) => (
      <FallingEdgeCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName={cn('fill-neutral-1000 dark:fill-neutral-100', {
          'fill-red-500 dark:fill-red-500': wrongVariable,
        })}
        parenthesesColor={debuggerColor}
      />
    ),
  },
  set: {
    svg: (wrongVariable, debuggerColor) => (
      <SetCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName={cn('fill-neutral-1000 dark:fill-neutral-100', {
          'fill-red-500 dark:fill-red-500': wrongVariable,
        })}
        parenthesesColor={debuggerColor}
      />
    ),
  },
  reset: {
    svg: (wrongVariable, debuggerColor) => (
      <ResetCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName={cn('fill-neutral-1000 dark:fill-neutral-100', {
          'fill-red-500 dark:fill-red-500': wrongVariable,
        })}
        parenthesesColor={debuggerColor}
      />
    ),
  },
}

// contact

export const DEFAULT_CONTACT_BLOCK_WIDTH = 24
export const DEFAULT_CONTACT_BLOCK_HEIGHT = 24

export const DEFAULT_CONTACT_CONNECTOR_X = DEFAULT_CONTACT_BLOCK_WIDTH
export const DEFAULT_CONTACT_CONNECTOR_Y = DEFAULT_CONTACT_BLOCK_HEIGHT / 2

export const DEFAULT_CONTACT_TYPES: ContactType = {
  default: {
    svg: (wrongVariable, debuggerColor): ReactNode => (
      <DefaultContact
        width={DEFAULT_CONTACT_BLOCK_WIDTH}
        height={DEFAULT_CONTACT_BLOCK_HEIGHT}
        strokeClassName={cn('stroke-neutral-1000 dark:stroke-neutral-100', {
          'stroke-red-500 dark:stroke-red-500': wrongVariable,
        })}
        strokeColor={debuggerColor}
      />
    ),
  },
  negated: {
    svg: (wrongVariable, debuggerColor): ReactNode => (
      <NegatedContact
        width={DEFAULT_CONTACT_BLOCK_WIDTH}
        height={DEFAULT_CONTACT_BLOCK_HEIGHT}
        strokeClassName={cn('stroke-neutral-1000 dark:stroke-neutral-100', {
          'stroke-red-500 dark:stroke-red-500': wrongVariable,
        })}
        strokeColor={debuggerColor}
      />
    ),
  },
  risingEdge: {
    svg: (wrongVariable, debuggerColor): ReactNode => (
      <RisingEdgeContact
        width={DEFAULT_CONTACT_BLOCK_WIDTH}
        height={DEFAULT_CONTACT_BLOCK_HEIGHT}
        strokeClassName={cn('stroke-neutral-1000 dark:stroke-neutral-100', {
          'stroke-red-500 dark:stroke-red-500': wrongVariable,
        })}
        strokeColor={debuggerColor}
      />
    ),
  },
  fallingEdge: {
    svg: (wrongVariable, debuggerColor): ReactNode => (
      <FallingEdgeContact
        width={DEFAULT_CONTACT_BLOCK_WIDTH}
        height={DEFAULT_CONTACT_BLOCK_HEIGHT}
        strokeClassName={cn('stroke-neutral-1000 dark:stroke-neutral-100', {
          'stroke-red-500 dark:stroke-red-500': wrongVariable,
        })}
        strokeColor={debuggerColor}
      />
    ),
  },
}

// parallel

export const DEFAULT_PARALLEL_WIDTH = 4
export const DEFAULT_PARALLEL_HEIGHT = 2

export const GAP = 0

export const DEFAULT_PARALLEL_CONNECTOR_Y = DEFAULT_PARALLEL_HEIGHT / 2

// placeholder

export const DEFAULT_PLACEHOLDER_WIDTH = 10
export const DEFAULT_PLACEHOLDER_HEIGHT = 10
export const DEFAULT_PLACEHOLDER_GAP = 15

export const DEFAULT_PLACEHOLDER_CONNECTOR_Y = DEFAULT_PLACEHOLDER_HEIGHT / 2

// power rail

export const DEFAULT_POWER_RAIL_WIDTH = 3
export const DEFAULT_POWER_RAIL_HEIGHT = 40

export const DEFAULT_POWER_RAIL_CONNECTOR_X = DEFAULT_POWER_RAIL_WIDTH
export const DEFAULT_POWER_RAIL_CONNECTOR_Y = DEFAULT_POWER_RAIL_HEIGHT / 2

// variable

export const DEFAULT_VARIABLE_WIDTH = 80
export const DEFAULT_VARIABLE_HEIGHT = 32

export const DEFAULT_VARIABLE_CONNECTOR_X = DEFAULT_VARIABLE_WIDTH
export const DEFAULT_VARIABLE_CONNECTOR_Y = DEFAULT_VARIABLE_HEIGHT / 2
