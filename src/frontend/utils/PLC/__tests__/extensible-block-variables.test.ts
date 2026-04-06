import type { BlockVariable, ClassifiedVariables } from '../extensible-block-variables'
import {
  assembleVariables,
  buildNextExtensibleInput,
  classifyBlockVariables,
  getExtensibleInputType,
  getMinInputCount,
  rebuildVariablesForInputCount,
  removeLastExtensibleInput,
} from '../extensible-block-variables'

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------
function makeVar(name: string, cls: string, typeDef = 'base-type', typeVal = 'INT'): BlockVariable {
  return { name, class: cls, type: { definition: typeDef, value: typeVal } }
}

function makeStandardAddVars(): BlockVariable[] {
  return [
    makeVar('EN', 'input', 'base-type', 'BOOL'),
    makeVar('IN1', 'input'),
    makeVar('IN2', 'input'),
    makeVar('OUT', 'output'),
    makeVar('ENO', 'output', 'base-type', 'BOOL'),
  ]
}

function makeMuxVars(): BlockVariable[] {
  return [
    makeVar('K', 'input', 'base-type', 'INT'),
    makeVar('IN0', 'input'),
    makeVar('IN1', 'input'),
    makeVar('OUT', 'output'),
  ]
}

// ---------------------------------------------------------------------------
// classifyBlockVariables
// ---------------------------------------------------------------------------
describe('classifyBlockVariables', () => {
  it('separates EN, fixed inputs, extensible inputs, and outputs', () => {
    const vars = makeStandardAddVars()
    const classified = classifyBlockVariables(vars)

    expect(classified.enVariable).toEqual(makeVar('EN', 'input', 'base-type', 'BOOL'))
    expect(classified.fixedInputs).toEqual([])
    expect(classified.extensibleInputs).toEqual([makeVar('IN1', 'input'), makeVar('IN2', 'input')])
    expect(classified.outputs).toEqual([makeVar('OUT', 'output'), makeVar('ENO', 'output', 'base-type', 'BOOL')])
  })

  it('treats K as a fixed input (not extensible, not EN)', () => {
    const vars = makeMuxVars()
    const classified = classifyBlockVariables(vars)

    expect(classified.enVariable).toBeUndefined()
    expect(classified.fixedInputs).toEqual([makeVar('K', 'input', 'base-type', 'INT')])
    expect(classified.extensibleInputs).toEqual([makeVar('IN0', 'input'), makeVar('IN1', 'input')])
  })

  it('includes inOut variables as fixed inputs', () => {
    const vars = [makeVar('MID', 'inOut'), makeVar('IN1', 'input'), makeVar('OUT', 'output')]
    const classified = classifyBlockVariables(vars)

    expect(classified.fixedInputs).toEqual([makeVar('MID', 'inOut')])
  })

  it('sorts extensible inputs by their numeric suffix', () => {
    const vars = [makeVar('IN3', 'input'), makeVar('IN1', 'input'), makeVar('IN2', 'input')]
    const classified = classifyBlockVariables(vars)

    expect(classified.extensibleInputs.map((v) => v.name)).toEqual(['IN1', 'IN2', 'IN3'])
  })

  it('handles empty variable list', () => {
    const classified = classifyBlockVariables([])
    expect(classified.enVariable).toBeUndefined()
    expect(classified.fixedInputs).toEqual([])
    expect(classified.extensibleInputs).toEqual([])
    expect(classified.outputs).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getExtensibleInputType
// ---------------------------------------------------------------------------
describe('getExtensibleInputType', () => {
  it('returns the type from the first extensible input', () => {
    const vars = makeStandardAddVars()
    const result = getExtensibleInputType(vars)
    expect(result).toEqual({ definition: 'base-type', value: 'INT' })
  })

  it('falls back to first non-EN input when no extensible inputs exist', () => {
    const vars = [makeVar('EN', 'input', 'base-type', 'BOOL'), makeVar('K', 'input', 'base-type', 'DINT')]
    const result = getExtensibleInputType(vars)
    expect(result).toEqual({ definition: 'base-type', value: 'DINT' })
  })

  it('returns default INT type when no inputs at all', () => {
    const vars = [makeVar('OUT', 'output')]
    const result = getExtensibleInputType(vars)
    expect(result).toEqual({ definition: 'base-type', value: 'INT' })
  })
})

// ---------------------------------------------------------------------------
// buildNextExtensibleInput
// ---------------------------------------------------------------------------
describe('buildNextExtensibleInput', () => {
  it('builds the next input after existing extensible inputs', () => {
    const vars = makeStandardAddVars()
    const next = buildNextExtensibleInput(vars)
    expect(next.name).toBe('IN3')
    expect(next.class).toBe('input')
    expect(next.type).toEqual({ definition: 'base-type', value: 'INT' })
  })

  it('starts at IN1 when there are no extensible inputs', () => {
    const vars = [makeVar('EN', 'input', 'base-type', 'BOOL'), makeVar('OUT', 'output')]
    const next = buildNextExtensibleInput(vars)
    expect(next.name).toBe('IN1')
  })

  it('handles MUX-style (starts at IN0)', () => {
    const vars = makeMuxVars()
    const next = buildNextExtensibleInput(vars)
    expect(next.name).toBe('IN2')
  })
})

// ---------------------------------------------------------------------------
// removeLastExtensibleInput
// ---------------------------------------------------------------------------
describe('removeLastExtensibleInput', () => {
  it('removes the last extensible input when above minimum', () => {
    const vars = [makeVar('IN1', 'input'), makeVar('IN2', 'input'), makeVar('IN3', 'input'), makeVar('OUT', 'output')]
    const result = removeLastExtensibleInput(vars)
    expect(result).not.toBeNull()
    expect(result!.map((v) => v.name)).toEqual(['IN1', 'IN2', 'OUT'])
  })

  it('returns null when at minimum (2 extensible inputs)', () => {
    const vars = [makeVar('IN1', 'input'), makeVar('IN2', 'input'), makeVar('OUT', 'output')]
    const result = removeLastExtensibleInput(vars)
    expect(result).toBeNull()
  })

  it('respects custom minExtensible parameter', () => {
    const vars = [makeVar('IN1', 'input'), makeVar('IN2', 'input'), makeVar('IN3', 'input'), makeVar('OUT', 'output')]
    const result = removeLastExtensibleInput(vars, 3)
    expect(result).toBeNull()
  })

  it('preserves EN and fixed inputs in the result', () => {
    const vars = [
      makeVar('EN', 'input', 'base-type', 'BOOL'),
      makeVar('K', 'input', 'base-type', 'DINT'),
      makeVar('IN1', 'input'),
      makeVar('IN2', 'input'),
      makeVar('IN3', 'input'),
      makeVar('OUT', 'output'),
    ]
    const result = removeLastExtensibleInput(vars)
    expect(result).not.toBeNull()
    expect(result!.map((v) => v.name)).toEqual(['EN', 'K', 'IN1', 'IN2', 'OUT'])
  })
})

// ---------------------------------------------------------------------------
// rebuildVariablesForInputCount
// ---------------------------------------------------------------------------
describe('rebuildVariablesForInputCount', () => {
  it('rebuilds with the target number of total non-EN inputs', () => {
    const vars = makeStandardAddVars()
    const result = rebuildVariablesForInputCount(vars, 4)
    const extensible = result.filter((v) => v.class === 'input' && /^IN\d+$/.test(v.name))
    expect(extensible.length).toBe(4)
    expect(extensible.map((v) => v.name)).toEqual(['IN1', 'IN2', 'IN3', 'IN4'])
  })

  it('enforces minimum of 2 extensible inputs even if target is lower', () => {
    const vars = makeStandardAddVars()
    const result = rebuildVariablesForInputCount(vars, 0)
    const extensible = result.filter((v) => v.class === 'input' && /^IN\d+$/.test(v.name))
    expect(extensible.length).toBe(2)
  })

  it('falls back to startIndex=1 when no extensible inputs exist', () => {
    // No IN<n> variables at all, so getExtensibleStartIndex should return 1
    const vars = [makeVar('K', 'input', 'base-type', 'DINT'), makeVar('OUT', 'output')]
    const result = rebuildVariablesForInputCount(vars, 3)
    const extensible = result.filter((v) => v.class === 'input' && /^IN\d+$/.test(v.name))
    expect(extensible[0].name).toBe('IN1')
  })

  it('accounts for fixed inputs when calculating extensible count', () => {
    const vars = [
      makeVar('K', 'input', 'base-type', 'DINT'),
      makeVar('IN0', 'input'),
      makeVar('IN1', 'input'),
      makeVar('OUT', 'output'),
    ]
    // Target 5 total non-EN: 1 fixed (K) + 4 extensible
    const result = rebuildVariablesForInputCount(vars, 5)
    const extensible = result.filter((v) => v.class === 'input' && /^IN\d+$/.test(v.name))
    expect(extensible.length).toBe(4)
  })

  it('preserves start index from MUX (starts at IN0)', () => {
    const vars = makeMuxVars()
    const result = rebuildVariablesForInputCount(vars, 4)
    const extensible = result.filter((v) => v.class === 'input' && /^IN\d+$/.test(v.name))
    expect(extensible[0].name).toBe('IN0')
  })
})

// ---------------------------------------------------------------------------
// assembleVariables
// ---------------------------------------------------------------------------
describe('assembleVariables', () => {
  it('assembles in order: EN, fixed, extensible, outputs', () => {
    const classified: ClassifiedVariables = {
      enVariable: makeVar('EN', 'input', 'base-type', 'BOOL'),
      fixedInputs: [makeVar('K', 'input')],
      extensibleInputs: [makeVar('IN1', 'input'), makeVar('IN2', 'input')],
      outputs: [makeVar('OUT', 'output')],
    }
    const result = assembleVariables(classified)
    expect(result.map((v) => v.name)).toEqual(['EN', 'K', 'IN1', 'IN2', 'OUT'])
  })

  it('omits EN when undefined', () => {
    const classified: ClassifiedVariables = {
      enVariable: undefined,
      fixedInputs: [],
      extensibleInputs: [makeVar('IN1', 'input')],
      outputs: [makeVar('OUT', 'output')],
    }
    const result = assembleVariables(classified)
    expect(result.map((v) => v.name)).toEqual(['IN1', 'OUT'])
  })
})

// ---------------------------------------------------------------------------
// getMinInputCount
// ---------------------------------------------------------------------------
describe('getMinInputCount', () => {
  it('returns fixedInputs.length + default minExtensible (2)', () => {
    const vars = makeMuxVars()
    // K is fixed, so min = 1 + 2 = 3
    expect(getMinInputCount(vars)).toBe(3)
  })

  it('uses 0 fixed inputs when there are none', () => {
    const vars = [makeVar('IN1', 'input'), makeVar('IN2', 'input')]
    expect(getMinInputCount(vars)).toBe(2)
  })

  it('respects custom minExtensible parameter', () => {
    const vars = [makeVar('K', 'input', 'base-type', 'DINT'), makeVar('IN1', 'input')]
    expect(getMinInputCount(vars, 3)).toBe(4) // 1 fixed + 3
  })
})
