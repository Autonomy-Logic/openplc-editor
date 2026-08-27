import type { PLCPou } from '../../../../middleware/shared/ports/types'
import { resolveFunctionBlockPins } from '../function-block-pins'

const TON_LIB = {
  functionBlocks: [
    {
      name: 'TON',
      inputs: [
        { name: 'IN', type: 'BOOL' },
        { name: 'PT', type: 'TIME' },
      ],
      inouts: [{ name: 'IO', type: 'INT' }],
      outputs: [
        { name: 'Q', type: 'BOOL' },
        { name: 'ET', type: 'TIME' },
      ],
    },
  ],
}

const pou = (name: string, variables: NonNullable<PLCPou['interface']>['variables']): PLCPou => ({
  name,
  pouType: 'function-block',
  interface: { variables },
  body: { language: 'st', value: '' },
})

describe('resolveFunctionBlockPins', () => {
  it('resolves a library block, grouping inputs then in-outs then outputs', () => {
    // The same grouping the editor draws on the block, so the generated struct
    // reads the way the block looks.
    const pins = resolveFunctionBlockPins('TON', [], [TON_LIB])

    expect(pins?.map((p) => [p.name, p.class])).toEqual([
      ['IN', 'input'],
      ['PT', 'input'],
      ['IO', 'inOut'],
      ['Q', 'output'],
      ['ET', 'output'],
    ])
  })

  it('maps an elementary pin type to a base type', () => {
    const pins = resolveFunctionBlockPins('TON', [], [TON_LIB])

    expect(pins?.[0].type).toEqual({ definition: 'base-type', value: 'BOOL' })
  })

  it('does not claim a generic pin is elementary', () => {
    // `ANY_NUM` has no type until it is wired, so there is no width to marshal.
    // Marking it a base type would invite a guess; the walkers refuse it instead.
    const generic = {
      functionBlocks: [{ name: 'ADD', inputs: [{ name: 'IN1', type: 'ANY_NUM' }], inouts: [], outputs: [] }],
    }
    const pins = resolveFunctionBlockPins('ADD', [], [generic])

    expect(pins?.[0].type.definition).toBe('user-data-type')
  })

  it('matches the block name case-insensitively', () => {
    expect(resolveFunctionBlockPins('ton', [], [TON_LIB])).not.toBeNull()
  })

  it('resolves a project block', () => {
    const project = pou('Accum', [
      {
        name: 'step',
        class: 'input',
        type: { definition: 'base-type', value: 'INT' },
        location: '',
        documentation: '',
      },
      {
        name: 'total',
        class: 'output',
        type: { definition: 'base-type', value: 'DINT' },
        location: '',
        documentation: '',
      },
    ])

    expect(resolveFunctionBlockPins('Accum', [project], [])?.map((p) => p.name)).toEqual(['step', 'total'])
  })

  it('lets a project block shadow a library block of the same name', () => {
    const project = pou('TON', [
      {
        name: 'mine',
        class: 'input',
        type: { definition: 'base-type', value: 'INT' },
        location: '',
        documentation: '',
      },
    ])

    expect(resolveFunctionBlockPins('TON', [project], [TON_LIB])?.map((p) => p.name)).toEqual(['mine'])
  })

  it('keeps a project block’s internal locals, for the caller to filter', () => {
    // The resolver reports what the block has; deciding what may cross is the
    // marshaller's job, and it excludes locals.
    const project = pou('Accum', [
      {
        name: 'step',
        class: 'input',
        type: { definition: 'base-type', value: 'INT' },
        location: '',
        documentation: '',
      },
      {
        name: 'acc',
        class: 'local',
        type: { definition: 'base-type', value: 'DINT' },
        location: '',
        documentation: '',
      },
    ])

    expect(resolveFunctionBlockPins('Accum', [project], [])?.map((p) => p.class)).toEqual(['input', 'local'])
  })

  it('drops a project variable in a class that is not a pin', () => {
    const project = pou('Accum', [
      {
        name: 'step',
        class: 'input',
        type: { definition: 'base-type', value: 'INT' },
        location: '',
        documentation: '',
      },
      {
        name: 'g',
        class: 'external',
        type: { definition: 'base-type', value: 'INT' },
        location: '',
        documentation: '',
      },
    ])

    expect(resolveFunctionBlockPins('Accum', [project], [])?.map((p) => p.name)).toEqual(['step'])
  })

  it('returns null when nothing declares the block', () => {
    expect(resolveFunctionBlockPins('Nowhere', [], [TON_LIB])).toBeNull()
  })

  it('ignores a project POU that is not a function block', () => {
    const program: PLCPou = { name: 'TON', pouType: 'program', body: { language: 'st', value: '' } }

    expect(resolveFunctionBlockPins('TON', [program], [])).toBeNull()
  })

  it('handles a function block POU with no interface at all', () => {
    const bare: PLCPou = { name: 'Bare', pouType: 'function-block', body: { language: 'st', value: '' } }

    expect(resolveFunctionBlockPins('Bare', [bare], [])).toEqual([])
  })

  it('returns nothing when given neither project nor libraries', () => {
    expect(resolveFunctionBlockPins('TON')).toBeNull()
  })
})
