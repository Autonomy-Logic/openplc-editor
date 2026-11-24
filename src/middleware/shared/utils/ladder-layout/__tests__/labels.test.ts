import type { PLCGlobalVariableList, PLCVariable, VariableClass } from '../../../ports/types'
import type { LadderLabelSource, LocationLabel } from '../labels'
import { aliasTooltip, EMPTY_LABEL_SOURCE, labelSourceSignature, resolveLocationLabel } from '../labels'

/** A BOOL variable of the given class bound to `location`. */
function boolVar(name: string, variableClass: VariableClass, location: string): PLCVariable {
  return { name, class: variableClass, type: { definition: 'base-type', value: 'BOOL' }, location, documentation: '' }
}

/** A global variable list a project can hold; the label source never carries it. */
const plantIo: PLCGlobalVariableList = {
  name: 'Plant_IO',
  variables: [boolVar('Ext_Level', 'global', '%IW2'), boolVar('Ext_Run', 'global', '%IX7.7')],
}

const aliasIndex: ReadonlyMap<string, string> = new Map([['Pump_1', '%QX0.1']])

/** The POU and resource of the BDD-17 rows; `plantIo` exists alongside them in the project. */
const source: LadderLabelSource = {
  pouVariables: [
    boolVar('Start', 'local', '%IX0.0'),
    boolVar('PumpOut', 'output', 'Pump_1'),
    boolVar('Spare', 'local', 'Old_IO'),
    boolVar('Unbound', 'local', ''),
    boolVar('Ext_Run', 'external', ''),
    boolVar('Ext_Level', 'external', ''),
    boolVar('Ext_Alias', 'external', ''),
    boolVar('Ext_Free', 'external', ''),
    {
      name: 'Arr',
      class: 'local',
      type: {
        definition: 'array',
        value: 'ARRAY[1..4] OF BOOL',
        data: { baseType: { definition: 'base-type', value: 'BOOL' }, dimensions: [{ dimension: '1..4' }] },
      },
      location: '%IX4.0',
      documentation: '',
    },
    {
      name: 'Motor',
      class: 'local',
      type: { definition: 'user-data-type', value: 'MOTOR_T' },
      location: '%IX5.0',
      documentation: '',
    },
    boolVar('Plant_IO', 'local', '%IX6.0'),
  ],
  globalVariables: [
    boolVar('Ext_Run', 'global', '%IX0.3'),
    boolVar('Ext_Alias', 'global', 'Pump_1'),
    boolVar('Ext_Free', 'global', ''),
  ],
}

describe('resolveLocationLabel: BDD-17 rows', () => {
  it('Start at %IX0.0 shows the literal address', () => {
    expect(resolveLocationLabel('Start', source)).toEqual({ kind: 'address', text: '%IX0.0' })
  })

  it('PumpOut bound to alias Pump_1 shows the alias name', () => {
    expect(resolveLocationLabel('PumpOut', source)).toEqual({ kind: 'alias', text: 'Pump_1' })
  })

  it('Spare bound to the unresolved alias Old_IO still shows the alias name', () => {
    expect(resolveLocationLabel('Spare', source)).toEqual({ kind: 'alias', text: 'Old_IO' })
  })

  it('Ext_Run, a VAR_EXTERNAL of a resource global at %IX0.3, shows the global address', () => {
    expect(resolveLocationLabel('Ext_Run', source)).toEqual({ kind: 'address', text: '%IX0.3' })
  })

  it('Ext_Level, a VAR_EXTERNAL whose only match is a global variable list member at %IW2, shows nothing', () => {
    expect(plantIo.variables.some((v) => v.name === 'Ext_Level' && v.location === '%IW2')).toBe(true)
    expect(resolveLocationLabel('Ext_Level', source)).toEqual({ kind: 'none' })
  })

  it('Arr[1], an array element, shows nothing even though Arr has a location', () => {
    expect(resolveLocationLabel('Arr[1]', source)).toEqual({ kind: 'none' })
  })

  it('Motor.Run, a structure member, shows nothing even though Motor has a location', () => {
    expect(resolveLocationLabel('Motor.Run', source)).toEqual({ kind: 'none' })
  })

  it('TRUE, a literal, shows nothing', () => {
    expect(resolveLocationLabel('TRUE', source)).toEqual({ kind: 'none' })
  })

  it('Foo, an undeclared name, shows nothing', () => {
    expect(resolveLocationLabel('Foo', source)).toEqual({ kind: 'none' })
  })
})

describe('resolveLocationLabel: binding rules', () => {
  it('gives none for a POU variable with an empty location', () => {
    expect(resolveLocationLabel('Unbound', source)).toEqual({ kind: 'none' })
  })

  it('gives the alias of the resource global for a VAR_EXTERNAL whose global is alias-bound', () => {
    expect(resolveLocationLabel('Ext_Alias', source)).toEqual({ kind: 'alias', text: 'Pump_1' })
  })

  it('gives none for a VAR_EXTERNAL whose resource global has no location', () => {
    expect(resolveLocationLabel('Ext_Free', source)).toEqual({ kind: 'none' })
  })

  it('resolves a VAR_EXTERNAL matching both a resource global and a list member to the resource global', () => {
    expect(plantIo.variables.some((v) => v.name === 'Ext_Run')).toBe(true)
    expect(resolveLocationLabel('Ext_Run', source)).toEqual({ kind: 'address', text: '%IX0.3' })
  })

  it('gives none for a qualified global variable list member name', () => {
    expect(resolveLocationLabel('Plant_IO.Ext_Level', source)).toEqual({ kind: 'none' })
  })

  it('gives none for a qualified name whose last segment is a located POU variable', () => {
    expect(resolveLocationLabel('Plant_IO.Start', source)).toEqual({ kind: 'none' })
  })

  it.each(['FALSE', 'true', '10', '3.14', '16#FF', 'T#5s', 'BOOL#1'])('gives none for the literal %s', (literal) => {
    expect(resolveLocationLabel(literal, source)).toEqual({ kind: 'none' })
  })

  it('gives none for any name against the empty source', () => {
    expect(resolveLocationLabel('Start', EMPTY_LABEL_SOURCE)).toEqual({ kind: 'none' })
  })
})

describe('resolveLocationLabel: case-insensitive names', () => {
  it('matches a POU variable whatever the case of the name', () => {
    expect(resolveLocationLabel('START', source)).toEqual({ kind: 'address', text: '%IX0.0' })
    expect(resolveLocationLabel('pumpout', source)).toEqual({ kind: 'alias', text: 'Pump_1' })
  })

  it('matches the resource global of a VAR_EXTERNAL whatever the case', () => {
    const mixedCase: LadderLabelSource = {
      pouVariables: [boolVar('ext_run', 'external', '')],
      globalVariables: [boolVar('EXT_RUN', 'global', '%IX0.3')],
    }
    expect(resolveLocationLabel('Ext_Run', mixedCase)).toEqual({ kind: 'address', text: '%IX0.3' })
  })
})

describe('EMPTY_LABEL_SOURCE', () => {
  it('holds only empty POU and resource global variable arrays', () => {
    expect(EMPTY_LABEL_SOURCE).toEqual({ pouVariables: [], globalVariables: [] })
  })
})

describe('aliasTooltip', () => {
  it('reads "<alias> -> <address>" when the alias index resolves the alias', () => {
    const label: LocationLabel = { kind: 'alias', text: 'Pump_1' }
    expect(aliasTooltip(label, aliasIndex)).toBe('Pump_1 -> %QX0.1')
  })

  it('reads "<alias> -> unresolved" when the alias index does not hold the alias', () => {
    const label: LocationLabel = { kind: 'alias', text: 'Old_IO' }
    expect(aliasTooltip(label, aliasIndex)).toBe('Old_IO -> unresolved')
  })

  it('gives no tooltip for a literal address', () => {
    expect(aliasTooltip({ kind: 'address', text: '%IX0.0' }, aliasIndex)).toBeUndefined()
  })

  it('gives no tooltip when there is no location', () => {
    expect(aliasTooltip({ kind: 'none' }, aliasIndex)).toBeUndefined()
  })

  it('gives the BDD-17 tooltips for the labels the resolver returns', () => {
    expect(aliasTooltip(resolveLocationLabel('PumpOut', source), aliasIndex)).toBe('Pump_1 -> %QX0.1')
    expect(aliasTooltip(resolveLocationLabel('Spare', source), aliasIndex)).toBe('Old_IO -> unresolved')
    expect(aliasTooltip(resolveLocationLabel('Start', source), aliasIndex)).toBeUndefined()
    expect(aliasTooltip(resolveLocationLabel('Ext_Run', source), aliasIndex)).toBeUndefined()
  })
})

describe('labelSourceSignature', () => {
  /** A fresh copy of a small source, so each case changes one field only. */
  function baseSource(): LadderLabelSource {
    return {
      pouVariables: [boolVar('Start', 'local', '%IX0.0'), boolVar('Ext_Run', 'external', '')],
      globalVariables: [boolVar('Ext_Run', 'global', '%IX0.3')],
    }
  }

  it('is equal for two sources built from the same variables', () => {
    expect(labelSourceSignature(baseSource())).toBe(labelSourceSignature(baseSource()))
  })

  it('is equal when only the documentation, the initial value or the debug flag differ', () => {
    const changed = baseSource()
    changed.pouVariables = [
      { ...boolVar('Start', 'local', '%IX0.0'), documentation: 'start push button', initialValue: 'TRUE', debug: true },
      boolVar('Ext_Run', 'external', ''),
    ]
    changed.globalVariables = [{ ...boolVar('Ext_Run', 'global', '%IX0.3'), documentation: 'run', debug: false }]

    expect(labelSourceSignature(changed)).toBe(labelSourceSignature(baseSource()))
  })

  it('differs when a POU variable location changes', () => {
    const changed = baseSource()
    changed.pouVariables = [boolVar('Start', 'local', '%IX0.1'), boolVar('Ext_Run', 'external', '')]

    expect(labelSourceSignature(changed)).not.toBe(labelSourceSignature(baseSource()))
  })

  it('differs when a resource global location changes', () => {
    const changed = baseSource()
    changed.globalVariables = [boolVar('Ext_Run', 'global', 'Pump_1')]

    expect(labelSourceSignature(changed)).not.toBe(labelSourceSignature(baseSource()))
  })

  it('differs when a variable class changes', () => {
    const changed = baseSource()
    changed.pouVariables = [boolVar('Start', 'local', '%IX0.0'), boolVar('Ext_Run', 'local', '')]

    expect(labelSourceSignature(changed)).not.toBe(labelSourceSignature(baseSource()))
  })

  it('differs when a variable name changes', () => {
    const changed = baseSource()
    changed.pouVariables = [boolVar('Begin', 'local', '%IX0.0'), boolVar('Ext_Run', 'external', '')]

    expect(labelSourceSignature(changed)).not.toBe(labelSourceSignature(baseSource()))
  })

  it('differs when a resource global name changes', () => {
    const changed = baseSource()
    changed.globalVariables = [boolVar('Ext_Stop', 'global', '%IX0.3')]

    expect(labelSourceSignature(changed)).not.toBe(labelSourceSignature(baseSource()))
  })
})
