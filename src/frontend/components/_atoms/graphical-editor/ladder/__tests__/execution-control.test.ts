import type { BlockVariant } from '../utils/types'
import { getBlockVariantAndExecutionControl } from '../utils/utils'

/** A pin of `pinClass` typed `value`, a base type or a generic one (ANY...). */
const pin = (name: string, pinClass: string, value: string): BlockVariant['variables'][number] => ({
  name,
  class: pinClass,
  type: { definition: value.startsWith('ANY') ? 'generic-type' : 'base-type', value },
})

const block = (name: string, pins: BlockVariant['variables']): BlockVariant => ({
  name,
  type: 'function',
  variables: pins,
  documentation: '',
  extensible: false,
})

/** TON-like: BOOL in, BOOL out. EQ-like: ANY_ELEMENTARY in, BOOL out. ADD-like: ANY_NUM in and out. */
const BOOL_TO_BOOL = block('BOOL_BLOCK', [pin('IN', 'input', 'BOOL'), pin('Q', 'output', 'BOOL')])
const ANY_COMPARE = block('EQ', [
  pin('IN1', 'input', 'ANY_ELEMENTARY'),
  pin('IN2', 'input', 'ANY_ELEMENTARY'),
  pin('OUT', 'output', 'BOOL'),
])
const ANY_NUM = block('ADD', [
  pin('IN1', 'input', 'ANY_NUM'),
  pin('IN2', 'input', 'ANY_NUM'),
  pin('OUT', 'output', 'ANY_NUM'),
])

const placed = (variant: BlockVariant, executionControl?: boolean) => {
  const result = getBlockVariantAndExecutionControl(variant, executionControl)
  return { on: result.executionControl, locked: result.lockExecutionControl }
}

describe('execution control of a block placed on a rung', () => {
  it('starts on unless the first input and output are exactly BOOL, locked only when BOOL cannot drive them', () => {
    expect(placed(BOOL_TO_BOOL)).toEqual({ on: false, locked: false })
    expect(placed(ANY_COMPARE)).toEqual({ on: true, locked: false })
    expect(placed(ANY_COMPARE, false)).toEqual({ on: false, locked: false })
    expect(placed(ANY_NUM)).toEqual({ on: true, locked: true })
    expect(placed(ANY_NUM, false)).toEqual({ on: true, locked: true })
  })
})
